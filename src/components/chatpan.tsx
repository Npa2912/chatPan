"use client";
/* eslint-disable @next/next/no-img-element */
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type FormEvent,
} from "react";
import {
  Sparkles,
  Plus,
  Search,
  PanelLeft,
  MessageSquare,
  Image as ImageIcon,
  FolderOpen,
  LayoutDashboard,
  Settings,
  ArrowUp,
  Paperclip,
  ChevronDown,
  Check,
  Copy,
  RotateCcw,
  Square,
  X,
  LogOut,
  Pin,
  Trash2,
  Pencil,
  Download,
  Menu,
  Sun,
  Moon,
  ArrowRight,
  LoaderCircle,
  ShieldCheck,
  Globe,
  FileText,
  ChevronRight,
} from "lucide-react";
import Markdown from "react-markdown";
import { Dialog } from "./ui/dialog";
import { useProviderModels } from "./use-provider-models";
import { motion, useReducedMotion } from "framer-motion";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
type Account = {
  id: string;
  name: string;
  email: string;
  role: string;
  verified: boolean;
  settings: { systemPrompt: string };
};
type Conversation = {
  id: string;
  title: string;
  pinned: boolean;
  folderId: string | null;
  updatedAt: string;
};
type Attachment = { id: string; name: string; mime: string };
type Message = {
  id: string;
  role: string;
  content: string;
  attachmentIds: string[];
  createdAt: string;
};
type Folder = { id: string; name: string };
type Generated = { id: string; prompt: string };
async function api(path: string, method = "GET", data?: unknown) {
  const res = await fetch("/api/" + path, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Yêu cầu thất bại.");
  return result;
}
export default function ChatPan() {
  const reducedMotion = useReducedMotion();
  const [account, setAccount] = useState<Account | null>(null),
    [loading, setLoading] = useState(true),
    [authMode, setAuthMode] = useState("login"),
    [authOpen, setAuthOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [active, setActive] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [folders, setFolders] = useState<Folder[]>([]);
  const [section, setSection] = useState("chat"),
    [search, setSearch] = useState(""),
    [sidebar, setSidebar] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [light, setLight] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const {
    modelList,
    model,
    providerError,
    validatingModel,
    loadModels,
    selectModel,
    resetModels,
  } = useProviderModels(api, setError);
  const [imageMode, setImageMode] = useState("vision");
  const [text, setText] = useState(""),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    [files, setFiles] = useState<Attachment[]>([]),
    [images, setImages] = useState<Generated[]>([]),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [settings, setSettings] = useState(false);
  const [imagePrompt, setImagePrompt] = useState(""),
    [imageBusy, setImageBusy] = useState(false),
    [admin, setAdmin] = useState<unknown>(null),
    [tokenAction, setTokenAction] = useState<{
      purpose: string;
      token: string;
    } | null>(null);
  const abort = useRef<AbortController | null>(null),
    end = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    const [c, f] = await Promise.all([api("conversations"), api("folders")]);
    setConversations(c);
    setFolders(f);
  }, []);
  useEffect(() => {
    let mounted = true;
    async function initialize() {
      const a = await api("me").catch(() => null);
      if (!mounted) return;
      setLight(localStorage.getItem("chatpan-theme") === "light");
      const query = new URLSearchParams(location.search);
      if (query.get("token")) {
        setTokenAction({
          purpose: query.get("action") || "",
          token: query.get("token")!,
        });
        history.replaceState({}, "", location.pathname);
      }
      if (a) {
        setAccount(a);
        refresh().catch(() => {});
        loadModels();
      }
      setLoading(false);
    }
    initialize();
    return () => {
      mounted = false;
    };
  }, [refresh, loadModels]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  function theme() {
    setLight(!light);
    localStorage.setItem("chatpan-theme", light ? "dark" : "light");
  }
  async function openConversation(id: string) {
    if (busy) return;
    try {
      const c = await api("conversations/" + id);
      setActive(id);
      setMessages(c.messages);
      setSection("chat");
      setSidebar(false);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function newChat() {
    if (busy) return;
    setActive(null);
    setMessages([]);
    setAttachments([]);
    setText("");
    setSection("chat");
    setSidebar(false);
    input.current?.focus();
  }
  async function patchConversation(c: Conversation, data: unknown) {
    try {
      await api("conversations/" + c.id, "PATCH", data);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function deleteConversation(id: string) {
    if (!confirm("Xóa vĩnh viễn cuộc trò chuyện này?")) return;
    try {
      await api("conversations/" + id, "DELETE");
      if (active === id) newChat();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function navigate(next: string) {
    setSection(next);
    setSidebar(false);
    if (!account) {
      setAuthOpen(true);
      return;
    }
    try {
      if (next === "files") setFiles(await api("files"));
      if (next === "images") setImages(await api("images"));
      if (next === "admin") setAdmin(await api("admin"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function upload(list: FileList | File[] | null) {
    if (!list) return;
    if (!account) {
      setAuthOpen(true);
      return;
    }
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(list).slice(0, 4 - attachments.length)) {
        if (file.size > 8 * 1024 * 1024) throw new Error("Tệp vượt quá 8 MB.");
        const data = new FormData();
        data.append("file", file);
        const res = await fetch("/api/files", { method: "POST", body: data });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);
        setAttachments((current) => [...current, result]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function send(regenerate = false) {
    if (busy || uploading) return;
    if (!account) {
      setAuthOpen(true);
      return;
    }
    if (!model) {
      setError(providerError || "Chọn model trước khi gửi.");
      return;
    }
    if (!regenerate && !text.trim() && !attachments.length) return;
    const content = text,
      attached = attachments;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    let id = active;
    try {
      if (!id) {
        const c = await api("conversations", "POST");
        id = c.id;
        setActive(id);
      }
      if (!regenerate) {
        setText("");
        setAttachments([]);
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "user",
            content,
            attachmentIds: attached.map((a) => a.id),
            createdAt: new Date().toISOString(),
          },
        ]);
      } else
        setMessages((current) =>
          current.at(-1)?.role === "assistant" ? current.slice(0, -1) : current,
        );
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          conversationId: id,
          content,
          model,
          attachments: attached.map((a) => a.id),
          regenerate,
          imageMode,
        }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error);
      }
      const assistantId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          attachmentIds: [],
          createdAt: new Date().toISOString(),
        },
      ]);
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line) continue;
          const data = JSON.parse(line);
          if (data.error) setError(data.error);
          if (data.delta)
            setMessages((current) =>
              current.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + data.delta }
                  : m,
              ),
            );
        }
        if (done) break;
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
      abort.current = null;
      await refresh().catch(() => {});
      if (id) {
        const c = await api("conversations/" + id).catch(() => null);
        if (c) setMessages(c.messages);
      }
    }
  }
  async function auth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (authMode === "forgot") {
        const result = await api("auth/forgot", "POST", {
          email: data.get("email"),
        });
        setNotice(result.message);
        return;
      }
      if (
        authMode === "register" &&
        data.get("password") !== data.get("confirm")
      )
        throw new Error("Mật khẩu xác nhận không khớp.");
      await api("auth/" + authMode, "POST", {
        email: data.get("email"),
        password: data.get("password"),
        name: data.get("name") || undefined,
        remember: data.get("remember") === "on",
      });
      setAccount(await api("me"));
      setAuthOpen(false);
      await refresh();
      await loadModels();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function logout() {
    abort.current?.abort();
    await api("auth/logout", "POST");
    setAccount(null);
    setConversations([]);
    setMessages([]);
    setActive(null);
    setSettings(false);
    setSection("chat");
    resetModels();
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    setImageBusy(true);
    setError("");
    try {
      await api("images", "POST", { prompt: imagePrompt });
      setImages(await api("images"));
      setImagePrompt("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImageBusy(false);
    }
  }
  function exportChat() {
    const data = new Blob([JSON.stringify({ messages }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chatpan-conversation.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  const visible = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div
      className={`app ${light ? "light" : ""} ${collapsed ? "collapsed" : ""}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        upload(e.dataTransfer.files);
      }}
    >
      {sidebar && (
        <div className="drawer-scrim" onClick={() => setSidebar(false)} />
      )}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <div className="brand">
          <Sparkles className="brand-icon" />
          <span>
            chat<span className="gold">Pan</span>
          </span>
          <button
            className="icon collapse-button"
            aria-label="Thu gọn thanh bên"
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeft size={17} />
          </button>
          <button
            className="icon mobile-close"
            aria-label="Đóng menu"
            onClick={() => setSidebar(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace">
          <div className="workspace-icon">P</div>
          <div>
            <strong>Không gian cá nhân</strong>
            <small>Your Personal AI Universe</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <button className="new-chat" onClick={newChat}>
          <Plus size={17} /> Cuộc trò chuyện mới <kbd>↵</kbd>
        </button>
        <nav>
          {[
            [LayoutDashboard, "dashboard", "Tổng quan"],
            [MessageSquare, "chat", "Trò chuyện"],
            [ImageIcon, "images", "Image Studio"],
            [FolderOpen, "files", "Thư viện tệp"],
          ].map(([Icon, key, label]) => {
            const I = Icon as typeof Search;
            return (
              <button
                key={key as string}
                className={section === key ? "selected" : ""}
                onClick={() => navigate(key as string)}
              >
                <I size={18} />
                {label as string}
                {key === "images" && <span className="badge">AI</span>}
              </button>
            );
          })}
        </nav>
        <label className="search">
          <Search size={16} />
          <input
            placeholder="Tìm cuộc trò chuyện"
            aria-label="Tìm cuộc trò chuyện"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>⌘ K</kbd>
        </label>
        <div className="history">
          <div className="section-label">
            <span>
              <FolderOpen size={14} /> Thư mục
            </span>
            <button
              className="icon"
              aria-label="Tạo thư mục"
              onClick={async () => {
                if (!account) {
                  setAuthOpen(true);
                  return;
                }
                const name = prompt("Tên thư mục");
                if (name)
                  try {
                    await api("folders", "POST", { name });
                    await refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  }
              }}
            >
              <Plus size={15} />
            </button>
          </div>
          {folders.map((f) => (
            <details key={f.id}>
              <summary>
                <FolderOpen size={14} />
                {f.name}
              </summary>
              {visible
                .filter((c) => c.folderId === f.id)
                .map((c) => (
                  <button
                    className="folder-conversation"
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                  >
                    {c.title}
                  </button>
                ))}
            </details>
          ))}
          <div className="section-label">
            <span>
              <Pin size={14} /> Đã ghim
            </span>
            <span>{conversations.filter((c) => c.pinned).length}</span>
          </div>
          {visible
            .filter((c) => c.pinned)
            .map((c) => (
              <button
                className="history-title"
                key={c.id}
                onClick={() => openConversation(c.id)}
              >
                <MessageSquare size={14} />
                <span>{c.title}</span>
              </button>
            ))}
          <div className="section-label recent">
            <span>Lịch sử trò chuyện</span>
            <Plus size={14} />
          </div>
          {!conversations.length && (
            <p className="empty-history">
              Ý tưởng lớn bắt đầu từ
              <br />
              một cuộc trò chuyện nhỏ.
            </p>
          )}
          {visible.map((c) => (
            <div
              key={c.id}
              className={`history-item ${active === c.id ? "active" : ""}`}
            >
              <button onClick={() => openConversation(c.id)}>
                <MessageSquare size={15} />
                <span>{c.title}</span>
              </button>
              <details className="conversation-menu">
                <summary aria-label={"Tùy chọn " + c.title}>···</summary>
                <div>
                  <button
                    onClick={() => {
                      const title = prompt("Tên cuộc trò chuyện", c.title);
                      if (title) patchConversation(c, { title });
                    }}
                  >
                    <Pencil size={14} />
                    Đổi tên
                  </button>
                  <button
                    onClick={() => patchConversation(c, { pinned: !c.pinned })}
                  >
                    <Pin size={14} />
                    {c.pinned ? "Bỏ ghim" : "Ghim"}
                  </button>
                  <select
                    aria-label="Chuyển vào thư mục"
                    value={c.folderId || ""}
                    onChange={(e) =>
                      patchConversation(c, { folderId: e.target.value || null })
                    }
                  >
                    <option value="">Không có thư mục</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => deleteConversation(c.id)}>
                    <Trash2 size={14} />
                    Xóa
                  </button>
                </div>
              </details>
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="free-note">
            <span className="status-dot" /> Không gian cho mọi ý tưởng{" "}
            <Sparkles size={14} />
          </div>
          <button
            className="profile"
            onClick={() => (account ? setSettings(true) : setAuthOpen(true))}
          >
            <span className="avatar">
              {account?.name.slice(0, 1).toUpperCase() || "P"}
            </span>
            <span>
              <strong>{account?.name || "Chào mừng đến chatPan"}</strong>
              <small>
                {account ? "Tài khoản cá nhân" : "Đăng nhập để bắt đầu"}
              </small>
            </span>
            <Settings size={17} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="icon mobile-menu"
            aria-label="Mở menu"
            onClick={() => setSidebar(true)}
          >
            <Menu size={21} />
          </button>
          {collapsed && (
            <button
              className="icon desktop-expand"
              aria-label="Mở thanh bên"
              onClick={() => setCollapsed(false)}
            >
              <PanelLeft size={20} />
            </button>
          )}
          <div className="top-model">
            <select
              aria-label="Chọn model"
              value={model}
              disabled={validatingModel || busy}
              onChange={(e) => selectModel(e.target.value)}
            >
              <option value="" disabled>
                {validatingModel ? "Đang xác minh model…" : "Chọn model AI"}
              </option>
              {modelList.map((m) => (
                <option key={m.id}>{m.id}</option>
              ))}
            </select>
            <span className="model-label">AI ASSISTANT</span>
          </div>
          <div className="top-links">
            <button
              onClick={() =>
                setNotice(
                  "chatPan · Trợ lý cá nhân. Xem README để cấu hình nhà cung cấp và triển khai.",
                )
              }
            >
              Hướng dẫn <ChevronRight size={13} />
            </button>
            <span className="private">
              <ShieldCheck size={14} />
              Không gian riêng tư
            </span>
            <button className="icon" aria-label="Đổi giao diện" onClick={theme}>
              {light ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button
              className="avatar"
              aria-label="Tài khoản"
              onClick={() => (account ? setSettings(true) : setAuthOpen(true))}
            >
              {account?.name[0]?.toUpperCase() || "P"}
            </button>
          </div>
        </header>
        {notice && (
          <div className="toast">
            <Check size={16} />
            {notice}
          </div>
        )}
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button
              className="icon"
              aria-label="Đóng lỗi"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {section === "chat" && (
          <>
            <div
              className={`chat-scroll ${!messages.length ? "welcome-scroll" : ""}`}
            >
              {!messages.length ? (
                <motion.section
                  className="welcome"
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                >
                  <div className="eyebrow">
                    <span className="status-dot" /> KHÔNG GIAN AI CỦA RIÊNG BẠN
                  </div>
                  <div className="welcome-symbol">
                    <Sparkles size={38} strokeWidth={1.5} />
                  </div>
                  <h1>
                    Mọi ý tưởng đều có
                    <br />
                    một <span>khởi đầu.</span>
                  </h1>
                  <p>
                    Hỏi điều bạn tò mò. Tạo điều bạn tưởng tượng.
                    <br />
                    Cùng chatPan, khám phá những khả năng mới.
                  </p>
                  <div className="suggestions">
                    {[
                      [
                        Sparkles,
                        "Khơi nguồn sáng tạo",
                        "Lên ý tưởng cho dự án tiếp theo",
                        "Gợi ý 5 ý tưởng sáng tạo cho một dự án cá nhân về công nghệ.",
                      ],
                      [
                        FileText,
                        "Làm việc thông minh",
                        "Tóm tắt, phân tích và viết tốt hơn",
                        "Hướng dẫn tôi cách tóm tắt một tài liệu hiệu quả.",
                      ],
                      [
                        Globe,
                        "Khám phá kiến thức",
                        "Biến câu hỏi lớn thành điều dễ hiểu",
                        "Giải thích trí tuệ nhân tạo bằng một ví dụ gần gũi.",
                      ],
                    ].map(([Icon, title, description, prompt]) => {
                      const I = Icon as typeof Sparkles;
                      return (
                        <button
                          key={title as string}
                          onClick={() => {
                            setText(prompt as string);
                            input.current?.focus();
                          }}
                        >
                          <I size={20} />
                          <strong>{title as string}</strong>
                          <small>{description as string}</small>
                          <ArrowRight className="suggestion-arrow" size={16} />
                        </button>
                      );
                    })}
                  </div>
                  {!loading && !account && (
                    <button
                      className="welcome-login"
                      onClick={() => setAuthOpen(true)}
                    >
                      Tạo không gian của bạn <ArrowRight size={15} />
                    </button>
                  )}
                </motion.section>
              ) : (
                <div className="messages">
                  {messages.map((m, i) => (
                    <article key={m.id} className={`message ${m.role}`}>
                      <div className="message-avatar">
                        {m.role === "assistant" ? (
                          <Sparkles size={18} />
                        ) : (
                          account?.name[0]
                        )}
                      </div>
                      <div className="message-body">
                        <div className="message-meta">
                          <strong>
                            {m.role === "assistant" ? "chatPan" : account?.name}
                          </strong>
                          <time>
                            {new Date(m.createdAt).toLocaleTimeString("vi-VN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                          {m.role === "assistant" && <span>AI</span>}
                        </div>
                        <div className="markdown">
                          <Markdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex, rehypeHighlight]}
                          >
                            {m.content || "Đang suy nghĩ…"}
                          </Markdown>
                        </div>
                        {m.attachmentIds.map((id) => (
                          <a
                            className="message-attachment"
                            key={id}
                            href={"/api/files/" + id}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Paperclip size={15} />
                            Tệp đính kèm
                          </a>
                        ))}
                        <div className="message-actions">
                          <button
                            aria-label="Sao chép tin nhắn"
                            onClick={() =>
                              navigator.clipboard
                                .writeText(m.content)
                                .then(() => setNotice("Đã sao chép."))
                                .catch(() =>
                                  setError("Không thể truy cập clipboard."),
                                )
                            }
                          >
                            <Copy size={14} />
                          </button>
                          {m.role === "user" && (
                            <button
                              aria-label="Dùng lại tin nhắn"
                              onClick={() => {
                                setText(m.content);
                                input.current?.focus();
                              }}
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                          {m.role === "assistant" &&
                            i === messages.length - 1 && (
                              <button
                                disabled={busy}
                                aria-label="Tạo lại phản hồi"
                                onClick={() => send(true)}
                              >
                                <RotateCcw size={14} />
                              </button>
                            )}
                        </div>
                      </div>
                    </article>
                  ))}
                  <div ref={end} />
                </div>
              )}
            </div>
            <div className="composer-wrap">
              <div className="composer">
                {attachments.length > 0 && (
                  <div className="attachments">
                    {attachments.map((file) => (
                      <div key={file.id}>
                        {file.mime.startsWith("image/") ? (
                          <img src={"/api/files/" + file.id} alt={file.name} />
                        ) : (
                          <FileText size={24} />
                        )}
                        <span>{file.name}</span>
                        <button
                          className="icon"
                          aria-label={"Bỏ " + file.name}
                          onClick={() =>
                            setAttachments((current) =>
                              current.filter((f) => f.id !== file.id),
                            )
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="composer-input">
                  <textarea
                    ref={input}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Hỏi bất cứ điều gì, hoặc bắt đầu một ý tưởng…"
                    aria-label="Tin nhắn"
                    rows={2}
                    maxLength={24000}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    onPaste={(e) => {
                      const pasted = Array.from(e.clipboardData.files);
                      if (pasted.length) {
                        e.preventDefault();
                        upload(pasted);
                      }
                    }}
                  />
                  {busy ? (
                    <button
                      className="send"
                      aria-label="Dừng tạo"
                      onClick={() => abort.current?.abort()}
                    >
                      <Square size={17} />
                    </button>
                  ) : (
                    <button
                      className="send"
                      aria-label="Gửi tin nhắn"
                      disabled={
                        uploading || (!text.trim() && !attachments.length)
                      }
                      onClick={() => send()}
                    >
                      <ArrowUp size={21} />
                    </button>
                  )}
                </div>
                <div className="composer-bottom">
                  {attachments.some((f) => f.mime.startsWith("image/")) && (
                    <select
                      aria-label="Chế độ phân tích ảnh"
                      className="image-mode"
                      value={imageMode}
                      onChange={(e) => setImageMode(e.target.value)}
                    >
                      <option value="vision">Vision · chưa xác minh</option>
                      <option value="ocr">OCR · chỉ trích xuất chữ</option>
                    </select>
                  )}
                  <button
                    onClick={() => fileInput.current?.click()}
                    disabled={uploading}
                  >
                    <Paperclip size={18} />
                    {uploading ? "Đang tải…" : "Đính kèm tệp"}
                    <span className="max-size">8 MB</span>
                  </button>
                  <div>
                    <span className="enter-note">↵ gửi · ⇧ ↵ xuống dòng</span>
                    <button
                      className="composer-model"
                      onClick={() =>
                        account ? loadModels() : setAuthOpen(true)
                      }
                    >
                      <Sparkles size={15} />
                      {model || "Kết nối AI"}
                      <ChevronDown size={14} />
                    </button>
                  </div>
                </div>
                <input
                  hidden
                  ref={fileInput}
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.csv,.xlsx"
                  onChange={(e) => upload(e.target.files)}
                />
              </div>
              <p className="disclaimer">
                <ShieldCheck size={12} /> AI có thể mắc lỗi. Hãy kiểm tra thông
                tin quan trọng. <span>chatPan · Your Personal AI Universe</span>
              </p>
            </div>
          </>
        )}
        {section === "dashboard" && (
          <section className="content-page">
            <div className="eyebrow">KHÔNG GIAN CÁ NHÂN</div>
            <h1>
              Chào {account?.name || "bạn"} <span className="gold">✦</span>
            </h1>
            <p>Tiếp nối những ý tưởng còn dang dở.</p>
            <div className="stat-grid">
              <div>
                <MessageSquare />
                <strong>{conversations.length}</strong>
                <span>Cuộc trò chuyện gần đây</span>
              </div>
              <div>
                <Pin />
                <strong>{conversations.filter((c) => c.pinned).length}</strong>
                <span>Đã ghim</span>
              </div>
              <div>
                <Sparkles />
                <strong>{modelList.length}</strong>
                <span>Model khả dụng</span>
              </div>
            </div>
            <h2>Gần đây</h2>
            {conversations.slice(0, 8).map((c) => (
              <button
                className="list-row"
                key={c.id}
                onClick={() => openConversation(c.id)}
              >
                <MessageSquare size={18} />
                <span>{c.title}</span>
                <ChevronRight size={16} />
              </button>
            ))}
            {!conversations.length && (
              <div className="empty-state">
                <MessageSquare />
                <p>Cuộc trò chuyện đầu tiên đang chờ bạn.</p>
                <button className="primary" onClick={newChat}>
                  Bắt đầu trò chuyện
                </button>
              </div>
            )}
            {providerError && <div className="info-card">{providerError}</div>}
          </section>
        )}
        {section === "files" && (
          <section className="content-page">
            <div className="eyebrow">TÀI LIỆU CỦA BẠN</div>
            <h1>Thư viện tệp</h1>
            <p>
              Tài liệu được lưu riêng tư. Đính kèm trong cuộc trò chuyện để phân
              tích.
            </p>
            <div className="info-card">
              Hỗ trợ PDF, DOCX, TXT, CSV, XLSX và ảnh JPEG, PNG, WebP. Tối đa 8
              MB mỗi tệp. OCR cần Tesseract trên server và chỉ trích xuất chữ;
              phân tích hình ảnh cần model hỗ trợ vision.
            </div>
            {files.map((f) => (
              <div className="list-row" key={f.id}>
                <FileText size={20} />
                <a href={"/api/files/" + f.id} target="_blank" rel="noreferrer">
                  {f.name}
                </a>
                <button
                  className="icon"
                  aria-label={"Xóa " + f.name}
                  onClick={async () => {
                    if (confirm("Xóa tệp này?"))
                      try {
                        await api("files/" + f.id, "DELETE");
                        setFiles(await api("files"));
                      } catch (e) {
                        setError((e as Error).message);
                      }
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {!files.length && (
              <div className="empty-state">
                <FolderOpen size={36} />
                <p>Tệp bạn đính kèm trong chat sẽ xuất hiện ở đây.</p>
                <button className="primary" onClick={newChat}>
                  Mở cuộc trò chuyện
                </button>
              </div>
            )}
          </section>
        )}
        {section === "images" && (
          <section className="content-page">
            <div className="eyebrow">BIẾN Ý TƯỞNG THÀNH HÌNH ẢNH</div>
            <h1>
              Image <span className="gold">Studio</span>
            </h1>
            <p>Mô tả thế giới bạn muốn nhìn thấy.</p>
            <form onSubmit={generate} className="studio-form">
              <textarea
                aria-label="Mô tả ảnh"
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="Một căn nhà nhỏ giữa rừng thông, nắng sớm xuyên qua tán lá…"
                required
                maxLength={4000}
              />
              <div>
                <span>1024 × 1024 · model do quản trị viên cấu hình</span>
                <button className="primary" disabled={imageBusy}>
                  {imageBusy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Sparkles size={17} />
                  )}
                  Tạo hình ảnh
                </button>
              </div>
            </form>
            <div className="info-card">
              Tạo ảnh chỉ hoạt động khi nhà cung cấp và DEFAULT_IMAGE_MODEL được
              cấu hình. Chưa xác minh tạo ảnh, chỉnh sửa ảnh hoặc các tùy chọn
              chất lượng.
            </div>
            <div className="image-grid">
              {images.map((image) => (
                <div key={image.id}>
                  <a
                    href={"/api/images/" + image.id}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img src={"/api/images/" + image.id} alt={image.prompt} />
                  </a>
                  <p>{image.prompt}</p>
                  <a href={"/api/images/" + image.id} download="chatpan.webp">
                    <Download size={16} />
                    Tải ảnh
                  </a>
                  <button
                    className="icon"
                    aria-label="Xóa ảnh"
                    onClick={async () => {
                      if (confirm("Xóa ảnh?"))
                        try {
                          await api("images/" + image.id, "DELETE");
                          setImages(await api("images"));
                        } catch (e) {
                          setError((e as Error).message);
                        }
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
        {section === "admin" && (
          <section className="content-page">
            <h1>Quản trị</h1>
            <pre>{JSON.stringify(admin, null, 2)}</pre>
          </section>
        )}
      </main>
      {(authOpen || tokenAction) && (
        <Dialog
          title="Tài khoản chatPan"
          onClose={() => {
            setAuthOpen(false);
            setTokenAction(null);
          }}
        >
          <button
            className="icon modal-close"
            aria-label="Đóng"
            onClick={() => {
              setAuthOpen(false);
              setTokenAction(null);
            }}
          >
            <X size={20} />
          </button>
          <div className="modal-logo">
            <Sparkles size={29} />
            chatPan
          </div>
          {tokenAction ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const data = new FormData(e.currentTarget);
                  const result = await api("auth/token", "POST", {
                    ...tokenAction,
                    password: data.get("password") || undefined,
                  });
                  setNotice(result.message);
                  setTokenAction(null);
                  setAuthOpen(true);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <h2>
                {tokenAction.purpose === "reset"
                  ? "Đặt lại mật khẩu"
                  : "Xác minh email"}
              </h2>
              {tokenAction.purpose === "reset" && (
                <label>
                  Mật khẩu mới
                  <input
                    name="password"
                    type="password"
                    minLength={10}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </label>
              )}
              <button className="primary">Xác nhận</button>
            </form>
          ) : (
            <>
              <h2>
                {authMode === "register"
                  ? "Một vũ trụ mới bắt đầu."
                  : authMode === "forgot"
                    ? "Tìm lại tài khoản."
                    : "Chào mừng trở lại."}
              </h2>
              <p>
                {authMode === "register"
                  ? "Tạo tài khoản để lưu ý tưởng của riêng bạn."
                  : "Tiếp tục khám phá cùng chatPan."}
              </p>
              <form onSubmit={auth}>
                {authMode === "register" && (
                  <label>
                    Tên hiển thị
                    <input
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={80}
                    />
                  </label>
                )}
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                  />
                </label>
                {authMode !== "forgot" && (
                  <label>
                    Mật khẩu
                    <input
                      name="password"
                      type="password"
                      autoComplete={
                        authMode === "login"
                          ? "current-password"
                          : "new-password"
                      }
                      minLength={10}
                      maxLength={128}
                      required
                      placeholder="Ít nhất 10 ký tự"
                    />
                  </label>
                )}
                {authMode === "register" && (
                  <label>
                    Xác nhận mật khẩu
                    <input
                      name="confirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={10}
                    />
                  </label>
                )}
                {authMode === "login" && (
                  <div className="auth-options">
                    <label>
                      <input type="checkbox" name="remember" defaultChecked />
                      Ghi nhớ tôi
                    </label>
                    <button type="button" onClick={() => setAuthMode("forgot")}>
                      Quên mật khẩu?
                    </button>
                  </div>
                )}
                <button className="primary">
                  {authMode === "register"
                    ? "Tạo tài khoản"
                    : authMode === "forgot"
                      ? "Gửi liên kết"
                      : "Đăng nhập"}
                  <ArrowRight size={16} />
                </button>
              </form>
              <button
                className="auth-switch"
                onClick={() => {
                  setAuthMode(authMode === "register" ? "login" : "register");
                  setError("");
                }}
              >
                {authMode === "register"
                  ? "Đã có tài khoản? Đăng nhập"
                  : "Chưa có tài khoản? Đăng ký"}
              </button>
            </>
          )}
          {error && <p className="form-error">{error}</p>}
        </Dialog>
      )}
      {settings && account && (
        <Dialog
          title="Cài đặt"
          className="modal settings-modal"
          onClose={() => setSettings(false)}
        >
          <button
            className="icon modal-close"
            aria-label="Đóng cài đặt"
            onClick={() => setSettings(false)}
          >
            <X size={20} />
          </button>
          <h2>Cài đặt cá nhân</h2>
          <p>
            {account.email} ·{" "}
            {account.verified ? "Đã xác minh" : "Chưa xác minh email"}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              try {
                await api("me", "PATCH", {
                  name: data.get("name"),
                  systemPrompt: data.get("systemPrompt"),
                });
                setAccount(await api("me"));
                setNotice("Đã lưu cài đặt.");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label>
              Tên hiển thị
              <input
                name="name"
                defaultValue={account.name}
                required
                maxLength={80}
              />
            </label>
            <label>
              Chỉ dẫn cho trợ lý
              <textarea
                name="systemPrompt"
                defaultValue={account.settings.systemPrompt}
                maxLength={4000}
              />
            </label>
            <button className="primary">Lưu thay đổi</button>
          </form>
          <div className="settings-actions">
            <button onClick={theme}>
              {light ? <Moon size={16} /> : <Sun size={16} />}Đổi giao diện
            </button>
            <button onClick={exportChat}>
              <Download size={16} />
              Xuất hội thoại hiện tại
            </button>
            {!account.verified && (
              <button
                onClick={async () => {
                  try {
                    setNotice((await api("auth/verify", "POST")).message);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <ShieldCheck size={16} />
                Gửi email xác minh
              </button>
            )}
            {account.role === "ADMIN" && (
              <button
                onClick={() => {
                  setSettings(false);
                  navigate("admin");
                }}
              >
                Bảng quản trị
              </button>
            )}
            <button onClick={logout}>
              <LogOut size={16} />
              Đăng xuất
            </button>
            <button
              className="danger"
              onClick={async () => {
                if (
                  confirm(
                    "Xóa tài khoản và toàn bộ dữ liệu? Không thể khôi phục.",
                  )
                )
                  try {
                    await api("me", "DELETE");
                    location.reload();
                  } catch (e) {
                    setError((e as Error).message);
                  }
              }}
            >
              <Trash2 size={16} />
              Xóa tài khoản
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </Dialog>
      )}
    </div>
  );
}
