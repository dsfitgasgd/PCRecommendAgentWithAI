import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .assistant import answer_question, configured_providers
from .auth import create_token, current_user, hash_password, verify_password
from .config import get_settings
from .database import Base, engine, get_db
from .knowledge import extract_text, split_text
from .live_search import research
from .models import Conversation, Favorite, KnowledgeChunk, KnowledgeDocument, Message, User
from .schemas import (
    AuthOut, ChatIn, ChatOut, ConversationOut, DocumentOut, FavoriteIn, FavoriteOut,
    LoginIn, MessageOut, RegisterIn, ResearchOut, UserOut,
)


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="数码罗盘 API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in get_settings().frontend_origin.split(",")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/status")
def status():
    return {"providers": configured_providers(), "live_search": bool(get_settings().tavily_api_key)}


@app.post("/api/auth/register", response_model=AuthOut, status_code=201)
def register(data: RegisterIn, db: Session = Depends(get_db)):
    user = User(email=data.email, display_name=data.display_name.strip(), password_hash=hash_password(data.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="邮箱已注册") from None
    db.refresh(user)
    return AuthOut(access_token=create_token(user.id), user=UserOut.model_validate(user))


@app.post("/api/auth/login", response_model=AuthOut)
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email.strip().lower()))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    return AuthOut(access_token=create_token(user.id), user=UserOut.model_validate(user))


@app.get("/api/users/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@app.get("/api/knowledge", response_model=list[DocumentOut])
def list_knowledge(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(KnowledgeDocument).where(KnowledgeDocument.user_id == user.id).order_by(KnowledgeDocument.created_at.desc())
    ).all()


@app.post("/api/knowledge", response_model=DocumentOut, status_code=201)
async def upload_knowledge(
    file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)
):
    filename = Path(file.filename or "").name[:255]
    if not filename:
        raise HTTPException(status_code=422, detail="文件名不能为空")
    limit = get_settings().upload_limit_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail="文件不能超过 5 MB")
    try:
        content = extract_text(filename, data)
    except Exception as exc:
        # Invalid or corrupt Word archives should be reported as bad uploads.
        raise HTTPException(status_code=422, detail=f"无法读取文件：{str(exc)[:120]}") from None
    if len(content) > 2_000_000:
        raise HTTPException(status_code=413, detail="文档文字过长")
    chunks = split_text(content)
    document = KnowledgeDocument(user_id=user.id, filename=filename, chunk_count=len(chunks))
    db.add(document)
    db.flush()
    db.add_all(KnowledgeChunk(document_id=document.id, content=chunk) for chunk in chunks)
    db.commit()
    db.refresh(document)
    return document


@app.delete("/api/knowledge/{document_id}", status_code=204)
def delete_knowledge(document_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    document = db.scalar(
        select(KnowledgeDocument).where(KnowledgeDocument.id == document_id, KnowledgeDocument.user_id == user.id)
    )
    if not document:
        raise HTTPException(status_code=404, detail="文档不存在")
    db.delete(document)
    db.commit()


@app.get("/api/research", response_model=ResearchOut)
def research_devices(
    query: str = Query(min_length=2, max_length=160),
    user: User = Depends(current_user),
):
    try:
        sources = research(query)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    except Exception:
        logger.exception("Live research failed")
        raise HTTPException(status_code=502, detail="实时检索暂时失败，请稍后重试") from None
    return ResearchOut(query=query, sources=sources, observed_at=datetime.now(timezone.utc))


@app.get("/api/favorites", response_model=list[FavoriteOut])
def list_favorites(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Favorite).where(Favorite.user_id == user.id).order_by(Favorite.saved_at.desc())).all()


@app.post("/api/favorites", response_model=FavoriteOut, status_code=201)
def add_favorite(data: FavoriteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    favorite = Favorite(
        user_id=user.id,
        title=data.title,
        source_url=str(data.source_url),
        source_name=data.source_name,
        price_text=data.price_text,
        note=data.note,
    )
    db.add(favorite)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="已经收藏过这个链接") from None
    db.refresh(favorite)
    return favorite


@app.delete("/api/favorites/{favorite_id}", status_code=204)
def delete_favorite(favorite_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    favorite = db.scalar(select(Favorite).where(Favorite.id == favorite_id, Favorite.user_id == user.id))
    if not favorite:
        raise HTTPException(status_code=404, detail="收藏不存在")
    db.delete(favorite)
    db.commit()


@app.get("/api/conversations", response_model=list[ConversationOut])
def list_conversations(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(Conversation).where(Conversation.user_id == user.id).order_by(Conversation.created_at.desc())
    ).all()


@app.get("/api/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def conversation_messages(conversation_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    conversation = db.scalar(
        select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user.id)
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="会话不存在")
    return db.scalars(select(Message).where(Message.conversation_id == conversation_id).order_by(Message.id)).all()


@app.post("/api/chat", response_model=ChatOut)
def chat(data: ChatIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    conversation = None
    if data.conversation_id is not None:
        conversation = db.scalar(
            select(Conversation).where(Conversation.id == data.conversation_id, Conversation.user_id == user.id)
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="会话不存在")
    if not configured_providers().get(data.provider):
        raise HTTPException(status_code=503, detail="所选模型未配置 API Key")
    history = []
    if conversation:
        history = [
            (entry.role, entry.content)
            for entry in db.scalars(
                select(Message).where(Message.conversation_id == conversation.id).order_by(Message.id.desc()).limit(10)
            ).all()[::-1]
        ]
    try:
        answer, sources = answer_question(db, user.id, data.provider, data.message, history)
    except Exception:
        logger.exception("AI agent failed")
        raise HTTPException(status_code=502, detail="模型暂时无法回答，请检查模型配置或稍后重试") from None
    if conversation is None:
        conversation = Conversation(user_id=user.id, title=data.message[:60])
        db.add(conversation)
        db.flush()
    db.add_all([
        Message(conversation_id=conversation.id, role="user", content=data.message),
        Message(conversation_id=conversation.id, role="assistant", content=answer),
    ])
    db.commit()
    return ChatOut(conversation_id=conversation.id, answer=answer, sources=sources)
