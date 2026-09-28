import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  ArrowRight, Bookmark, Check, ChevronDown, Clock3, Compass, ExternalLink, FileText,
  Heart, Layers3, LogOut, Menu, MessageCircle, Plus, Search, Send, ShieldCheck,
  SlidersHorizontal, Sparkles, Trash2, UploadCloud, UserRound, X,
} from 'lucide-react'
import {
  api, formatTime, postJson, type AppStatus, type ChatMessage, type Conversation,
  type Evidence, type Favorite, type KnowledgeDoc, type Provider, type Section, type User,
} from './api'

const suggestions = [
  { icon: '⌘', title: '轻薄办公本', prompt: '预算 6000 元左右，主要写代码和出差，帮我推荐轻薄笔记本，并查最新价格和参数。' },
  { icon: '◉', title: '拍照手机', prompt: '我喜欢拍人像和夜景，预算 4000 元，推荐手机并比较用户评价。' },
  { icon: '♫', title: '降噪耳机', prompt: '通勤和办公室使用，想要佩戴舒适的降噪耳机，预算 1500 元。' },
]

const providerLabels: Record<Provider, string> = {
  deepseek: 'DeepSeek', anthropic: 'Claude', openai: 'OpenAI',
}

const navItems = [
  { id: 'chat' as const, label: '智能对话', icon: MessageCircle },
  { id: 'discover' as const, label: '发现设备', icon: Compass },
  { id: 'favorites' as const, label: '我的收藏', icon: Heart },
  { id: 'knowledge' as const, label: '个人知识库', icon: Layers3 },
]

const kindLabels: Record<Evidence['kind'], string> = {
  shopping: '价格与购买', specs: '参数资料', reviews: '用户评价',
}

function App() {
  const [section, setSection] = useState<Section>('chat')
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [notice, setNotice] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [provider, setProvider] = useState<Provider>('deepseek')
  const [prompt, setPrompt] = useState('')
  const [busyChat, setBusyChat] = useState(false)
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [researchQuery, setResearchQuery] = useState('')
  const [researchResult, setResearchResult] = useState<Evidence[]>([])
  const [researchSearched, setResearchSearched] = useState(false)
  const [busyResearch, setBusyResearch] = useState(false)
  const [researchFilter, setResearchFilter] = useState<'all' | Evidence['kind']>('all')
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([])
  const [busyUpload, setBusyUpload] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api<AppStatus>('/status').then(value => {
      setStatus(value)
      const first = (Object.keys(value.providers) as Provider[]).find(key => value.providers[key])
      if (first) setProvider(first)
    }).catch(() => setNotice('无法连接后端，请确认 FastAPI 已启动'))
    if (localStorage.getItem('digital_compass_token')) {
      api<User>('/users/me').then(setUser).catch(() => localStorage.removeItem('digital_compass_token'))
    }
  }, [])

  useEffect(() => {
    if (!user) return
    void refreshCollections()
  }, [user])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busyChat])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  async function refreshCollections() {
    const results = await Promise.allSettled([
      api<Conversation[]>('/conversations'), api<Favorite[]>('/favorites'), api<KnowledgeDoc[]>('/knowledge'),
    ])
    if (results[0].status === 'fulfilled') setConversations(results[0].value)
    if (results[1].status === 'fulfilled') setFavorites(results[1].value)
    if (results[2].status === 'fulfilled') setDocuments(results[2].value)
  }

  function requireUser(): boolean {
    if (user) return true
    setAuthOpen(true)
    setNotice('登录后即可保存对话、知识库和收藏')
    return false
  }

  function handleAuth(result: { access_token: string; user: User }) {
    localStorage.setItem('digital_compass_token', result.access_token)
    setUser(result.user)
    setAuthOpen(false)
    setNotice(`欢迎回来，${result.user.display_name}`)
  }

  function logout() {
    localStorage.removeItem('digital_compass_token')
    setUser(null)
    setMessages([])
    setConversationId(null)
    setConversations([])
    setFavorites([])
    setDocuments([])
    setSection('chat')
  }

  function selectSection(next: Section) {
    setSection(next)
    setMobileMenu(false)
  }

  async function selectConversation(id: number) {
    if (!requireUser()) return
    try {
      const history = await api<ChatMessage[]>(`/conversations/${id}/messages`)
      setConversationId(id)
      setMessages(history)
      selectSection('chat')
    } catch (error) { setNotice((error as Error).message) }
  }

  async function sendChat(value = prompt) {
    const text = value.trim()
    if (!text || busyChat || !requireUser()) return
    if (!status?.providers[provider]) { setNotice('请先在后端配置所选模型的 API Key'); return }
    setPrompt('')
    setSection('chat')
    setMessages(current => [...current, { role: 'user', content: text }])
    setBusyChat(true)
    try {
      const result = await postJson<{ conversation_id: number; answer: string; sources: Evidence[] }>('/chat', {
        message: text, provider, conversation_id: conversationId,
      })
      setConversationId(result.conversation_id)
      setMessages(current => [...current, { role: 'assistant', content: result.answer, sources: result.sources }])
      setConversations(await api<Conversation[]>('/conversations'))
    } catch (error) { setNotice((error as Error).message) }
    finally { setBusyChat(false) }
  }

  async function doResearch(value = researchQuery) {
    const query = value.trim()
    if (query.length < 2 || !requireUser()) return
    setResearchQuery(query)
    setResearchSearched(true)
    setBusyResearch(true)
    setResearchResult([])
    try {
      const result = await api<{ sources: Evidence[] }>(`/research?query=${encodeURIComponent(query)}`)
      setResearchResult(result.sources)
      if (!result.sources.length) setNotice('没有找到可引用的来源，请换一个具体型号或关键词')
    } catch (error) { setNotice((error as Error).message) }
    finally { setBusyResearch(false) }
  }

  async function saveFavorite(item: Evidence) {
    if (!requireUser()) return
    try {
      await postJson('/favorites', {
        title: item.title, source_url: item.url, source_name: item.source_name, price_text: item.price_text,
      })
      setFavorites(await api<Favorite[]>('/favorites'))
      setNotice('已加入收藏')
    } catch (error) { setNotice((error as Error).message) }
  }

  async function deleteFavorite(id: number) {
    try {
      await api(`/favorites/${id}`, { method: 'DELETE' })
      setFavorites(current => current.filter(item => item.id !== id))
    } catch (error) { setNotice((error as Error).message) }
  }

  async function uploadDocument(file?: File) {
    if (!file || !requireUser()) return
    const form = new FormData()
    form.append('file', file)
    setBusyUpload(true)
    try {
      await api('/knowledge', { method: 'POST', body: form })
      setDocuments(await api<KnowledgeDoc[]>('/knowledge'))
      setNotice('文档已导入，可以在对话中使用')
    } catch (error) { setNotice((error as Error).message) }
    finally { setBusyUpload(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function deleteDocument(id: number) {
    try {
      await api(`/knowledge/${id}`, { method: 'DELETE' })
      setDocuments(current => current.filter(item => item.id !== id))
    } catch (error) { setNotice((error as Error).message) }
  }

  const filteredResearch = researchFilter === 'all' ? researchResult : researchResult.filter(item => item.kind === researchFilter)
  const savedUrls = new Set(favorites.map(item => item.source_url))

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="brand"><span className="brand-mark"><Compass size={23} strokeWidth={2.5} /></span><div><strong>数码罗盘</strong><small>DIGITAL COMPASS</small></div></div>
        <div className="sidebar-main">
          <div className="nav-heading">工作空间</div>
          <nav className="main-nav">
            {navItems.map(item => <button key={item.id} className={`nav-item ${section === item.id ? 'active' : ''}`} onClick={() => selectSection(item.id)}><item.icon size={19} strokeWidth={1.9} /><span>{item.label}</span>{item.id === 'favorites' && favorites.length > 0 && <em>{favorites.length}</em>}</button>)}
          </nav>
          <div className="sidebar-divider" />
          <div className="sidebar-row"><span className="nav-heading">最近对话</span><button className="icon-button subtle" title="新建对话" onClick={() => { setConversationId(null); setMessages([]); selectSection('chat') }}><Plus size={17} /></button></div>
          <div className="history-list">
            {conversations.length ? conversations.slice(0, 6).map(item => <button key={item.id} className={`history-item ${conversationId === item.id ? 'selected' : ''}`} onClick={() => void selectConversation(item.id)}><MessageCircle size={15} /><span>{item.title}</span></button>) : <div className="sidebar-empty">对话会显示在这里</div>}
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="source-status"><span className={`status-dot ${status?.live_search ? 'online' : ''}`} /><div><strong>{status?.live_search ? '实时检索已连接' : '实时检索未配置'}</strong><span>{status?.live_search ? '价格与评价有据可查' : '配置 Tavily 后启用'}</span></div></div>
          {user ? <div className="profile"><div className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</div><div className="profile-name"><strong>{user.display_name}</strong><span>{user.email}</span></div><button className="icon-button" title="退出登录" onClick={logout}><LogOut size={17} /></button></div> : <button className="login-sidebar" onClick={() => setAuthOpen(true)}><UserRound size={18} /> 登录 / 注册 <ArrowRight size={16} /></button>}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={22} /></button><div className="breadcrumb"><span>工作空间</span><span className="crumb-slash">/</span><strong>{navItems.find(item => item.id === section)?.label}</strong></div><div className="top-actions"><span className="top-date">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span><span className="top-avatar"><UserRound size={17} /></span></div></header>

        {section === 'chat' && <div className={`page chat-page ${messages.length ? 'has-messages' : ''}`}>
          {messages.length ? <div className="chat-thread">
            <div className="thread-heading"><div><span className="eyebrow">AI ADVISOR</span><h1>为你找到更合适的选择</h1></div><button className="outline-button" onClick={() => { setConversationId(null); setMessages([]) }}><Plus size={16} /> 新对话</button></div>
            {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`message-row ${message.role}`}><div className="message-avatar">{message.role === 'assistant' ? <Sparkles size={18} /> : (user?.display_name[0] || '你')}</div><div className="message-content"><div className="message-author">{message.role === 'assistant' ? '数码罗盘' : '你'}</div><div className="message-text">{message.role === 'assistant' ? <ReactMarkdown>{message.content}</ReactMarkdown> : message.content}</div>{message.sources && message.sources.length > 0 && <div className="message-sources"><span>参考来源 · {message.sources.length}</span><div>{message.sources.slice(0, 4).map(item => <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">{item.source_name}<ExternalLink size={12} /></a>)}</div></div>}</div></div>)}
            {busyChat && <div className="message-row assistant"><div className="message-avatar"><Sparkles size={18} /></div><div className="message-content"><div className="message-author">数码罗盘</div><div className="typing"><i /><i /><i /></div></div></div>}
            <div ref={endRef} />
          </div> : <div className="welcome-content"><div className="welcome-orbit"><span><Sparkles size={25} /></span></div><div className="eyebrow">YOUR PERSONAL TECH ADVISOR</div><h1>找到真正<span>适合你</span>的数码设备。</h1><p>告诉我你的预算、使用场景和偏好。我会结合实时价格、真实评价与个人资料，帮你缩小选择范围。</p><div className="suggestions">{suggestions.map(item => <button key={item.title} className="suggestion" onClick={() => void sendChat(item.prompt)}><span className="suggestion-icon">{item.icon}</span><span>{item.title}</span><ArrowRight size={16} /></button>)}</div></div>}
          <div className="chat-compose-wrap"><div className="chat-composer"><textarea value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendChat() } }} placeholder="描述你的需求，例如：预算 5000 元，想买一台适合剪辑的笔记本..." rows={2} /><div className="composer-bottom"><div className="provider-select"><Sparkles size={15} /><select value={provider} onChange={event => setProvider(event.target.value as Provider)} aria-label="选择模型">{(Object.keys(providerLabels) as Provider[]).map(key => <option key={key} value={key}>{providerLabels[key]}{status && !status.providers[key] ? ' · 未配置' : ''}</option>)}</select><ChevronDown size={14} /></div><span className="compose-tip">Enter 发送 · Shift + Enter 换行</span><button className="send-button" onClick={() => void sendChat()} disabled={!prompt.trim() || busyChat} title="发送"><Send size={18} /></button></div></div><div className="compose-disclaimer"><ShieldCheck size={14} /> 涉及价格和购买链接时，请以来源页面的最新信息为准</div></div>
        </div>}

        {section === 'discover' && <div className="page content-page"><div className="page-head"><span className="eyebrow">EXPLORE DEVICES</span><h1>发现设备<span className="accent-dot">.</span></h1><p>搜索具体设备或你的使用需求，查看有来源的报价、参数和评价。</p></div><div className="research-search"><Search size={22} /><input value={researchQuery} onChange={event => setResearchQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void doResearch() }} placeholder="搜索设备或需求，例如：轻薄笔记本 6000 元" /><button onClick={() => void doResearch()} disabled={busyResearch}>{busyResearch ? '检索中...' : '开始探索'}<ArrowRight size={17} /></button></div><div className="research-note"><Clock3 size={15} /> 实时查询公开网页，价格随活动和地区变化；仅商家页面标记为购买链接。</div>
          {researchSearched ? <><div className="result-toolbar"><div><h2>检索结果</h2><span>{busyResearch ? '正在收集资料' : `共 ${researchResult.length} 条来源`}</span></div><div className="filter-tabs"><SlidersHorizontal size={16} />{([['all','全部'],['shopping','价格'],['specs','参数'],['reviews','评价']] as const).map(([key,label]) => <button key={key} className={researchFilter === key ? 'active' : ''} onClick={() => setResearchFilter(key)}>{label}</button>)}</div></div>{busyResearch ? <div className="loading-grid">{[1,2,3,4].map(item => <div key={item} className="skeleton-card" />)}</div> : filteredResearch.length ? <div className="evidence-grid">{filteredResearch.map((item, index) => <EvidenceCard key={`${item.url}-${index}`} item={item} saved={savedUrls.has(item.url)} onSave={() => void saveFavorite(item)} />)}</div> : <EmptyState icon={<Search size={26} />} title="还没有可展示的来源" description="换一个更具体的型号或调整筛选条件再试试。" />}</> : <div className="discover-empty"><div className="discover-art"><div className="art-chip chip-one">价格</div><div className="art-chip chip-two">参数</div><div className="art-chip chip-three">评价</div><Compass size={82} strokeWidth={1.1} /></div><h2>从一个问题开始</h2><p>我们会把公开网页中的线索整理在一起，每条信息都能回到原始来源。</p></div>}
        </div>}

        {section === 'favorites' && <div className="page content-page"><div className="page-head page-head-row"><div><span className="eyebrow">SAVED FOR LATER</span><h1>我的收藏<span className="accent-dot">.</span></h1><p>把值得比较的设备与购买页面放在一个地方。</p></div><span className="count-badge">{favorites.length} 个收藏</span></div>{favorites.length ? <div className="favorite-list">{favorites.map(item => <div key={item.id} className="favorite-card"><div className="favorite-icon"><Bookmark size={22} /></div><div className="favorite-info"><span className="favorite-source">{item.source_name} · 收藏于 {formatTime(item.saved_at)}</span><h3>{item.title}</h3>{item.price_text && <strong className="favorite-price">{item.price_text}</strong>}</div><a className="external-button" href={item.source_url} target="_blank" rel="noopener noreferrer" title="打开来源"><ExternalLink size={18} /></a><button className="icon-button delete-button" title="取消收藏" onClick={() => void deleteFavorite(item.id)}><Trash2 size={18} /></button></div>)}</div> : <EmptyState icon={<Heart size={28} />} title="还没有收藏的设备" description="在“发现设备”的检索结果里点击收藏，方便稍后比较。" action={<button className="primary-button" onClick={() => selectSection('discover')}>去发现设备 <ArrowRight size={17} /></button>} />}</div>}

        {section === 'knowledge' && <div className="page content-page"><div className="page-head"><span className="eyebrow">YOUR KNOWLEDGE</span><h1>个人知识库<span className="accent-dot">.</span></h1><p>导入你的购物清单、已有设备或偏好记录，让推荐更懂你。</p></div><div className="knowledge-layout"><div className="upload-card" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void uploadDocument(event.dataTransfer.files[0]) }}><div className="upload-icon"><UploadCloud size={30} /></div><h2>添加你的资料</h2><p>拖拽文件到这里，或点击下方选择文件</p><button className="primary-button" onClick={() => { if (requireUser()) fileRef.current?.click() }} disabled={busyUpload}>{busyUpload ? '正在导入...' : '选择文件'}<Plus size={17} /></button><input ref={fileRef} type="file" accept=".txt,.md,.docx" hidden onChange={event => void uploadDocument(event.target.files?.[0])} /><div className="upload-foot">支持 TXT、Markdown、DOCX · 单文件不超过 5 MB</div></div><div className="knowledge-side"><div className="knowledge-tip"><Sparkles size={19} /><div><strong>资料如何发挥作用？</strong><p>对话时，助手会检索你的文档片段，结合预算和使用场景给出建议。资料仅属于你的账号。</p></div></div><div className="knowledge-docs"><div className="list-title"><h2>已导入文档</h2><span>{documents.length} 个文件</span></div>{documents.length ? documents.map(item => <div key={item.id} className="doc-row"><div className="doc-icon"><FileText size={20} /></div><div><strong>{item.filename}</strong><span>{item.chunk_count} 个片段 · {formatTime(item.created_at)}</span></div><button className="icon-button delete-button" title="删除文档" onClick={() => void deleteDocument(item.id)}><Trash2 size={17} /></button></div>) : <div className="docs-empty">还没有导入文档</div>}</div></div></div></div>}
      </main>

      {notice && <div className="toast"><span>{notice}</span><button onClick={() => setNotice('')}><X size={15} /></button></div>}
      {authOpen && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthOpen(false)} onSuccess={handleAuth} />}
    </div>
  )
}

function EvidenceCard({ item, saved, onSave }: { item: Evidence; saved: boolean; onSave: () => void }) {
  return <article className="evidence-card"><div className="card-top"><span className={`kind-tag ${item.kind}`}>{kindLabels[item.kind]}</span><button className={`save-button ${saved ? 'saved' : ''}`} title={saved ? '已收藏' : '收藏'} onClick={onSave}>{saved ? <Check size={17} /> : <Heart size={17} />}</button></div><h3>{item.title}</h3><div className="card-source"><span className="source-favicon">{item.source_name.slice(0, 1).toUpperCase()}</span>{item.source_name}</div><p>{item.snippet || '该来源没有可用摘要，请打开原网页查看。'}</p>{(item.price_text || item.rating_text) && <div className="card-metrics">{item.price_text && <strong>{item.price_text}</strong>}{item.rating_text && <span>评分 {item.rating_text}</span>}</div>}<div className="card-bottom"><span><Clock3 size={13} /> {formatTime(item.observed_at)} 查询</span><a href={item.url} target="_blank" rel="noopener noreferrer">{item.is_purchase_link ? '查看购买页' : '查看来源'}<ExternalLink size={14} /></a></div></article>
}

function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{description}</p>{action}</div>
}

function AuthModal({ mode, setMode, onClose, onSuccess }: { mode: 'login' | 'register'; setMode: (mode: 'login' | 'register') => void; onClose: () => void; onSuccess: (result: { access_token: string; user: User }) => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await postJson<{ access_token: string; user: User }>(mode === 'login' ? '/auth/login' : '/auth/register', mode === 'login' ? { email, password } : { email, display_name: name, password })
      onSuccess(result)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><div className="auth-modal"><button className="modal-close icon-button" onClick={onClose}><X size={20} /></button><div className="auth-logo"><Compass size={24} /></div><span className="eyebrow">WELCOME TO DIGITAL COMPASS</span><h2>{mode === 'login' ? '欢迎回来' : '创建你的账号'}</h2><p>{mode === 'login' ? '继续探索真正适合你的数码设备。' : '保存你的偏好、资料和每一次发现。'}</p><form onSubmit={event => void submit(event)}>{mode === 'register' && <label>昵称<input value={name} onChange={event => setName(event.target.value)} placeholder="如何称呼你" required maxLength={80} /></label>}<label>邮箱<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required /></label><label>密码<input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 8 位" required minLength={8} /></label>{error && <div className="form-error">{error}</div>}<button className="auth-submit" disabled={busy}>{busy ? '请稍候...' : mode === 'login' ? '登录' : '注册并开始'}<ArrowRight size={17} /></button></form><div className="auth-switch">{mode === 'login' ? '还没有账号？' : '已有账号？'}<button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? '立即注册' : '返回登录'}</button></div></div></div>
}

export default App
