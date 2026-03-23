import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { QrCode, Smartphone, RefreshCw, Plus, MessageCircle, Settings, Tag as TagIcon, Menu, X, Edit2, XCircle, HardDrive, Image as ImageIcon, Download, Trash2, Play, Pause } from 'lucide-react';
import { Column, Chat, Tag, Message } from './types';
import { format } from 'date-fns';

const socket = io('/', { transports: ['websocket', 'polling'] });

function AudioPlayer({ src }: { src: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = React.useRef<HTMLAudioElement>(null);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (audioRef.current) {
      const newTime = (Number(e.target.value) / 100) * audioRef.current.duration;
      audioRef.current.currentTime = newTime;
      setProgress(Number(e.target.value));
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 bg-black/5 rounded-full p-2 min-w-[200px] w-full max-w-[300px]">
      <button 
        onClick={togglePlay} 
        className="w-8 h-8 flex items-center justify-center bg-blue-500 text-white rounded-full hover:bg-blue-600 flex-shrink-0"
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-1" />}
      </button>
      <div className="flex-1 flex flex-col justify-center">
        <input 
          type="range" 
          min="0" 
          max="100" 
          value={progress || 0} 
          onChange={handleSeek}
          className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <div className="flex justify-between text-[10px] text-gray-500 mt-1 px-1">
          <span>{formatTime(audioRef.current?.currentTime || 0)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <audio 
        ref={audioRef} 
        src={src} 
        onTimeUpdate={handleTimeUpdate} 
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => { setIsPlaying(false); setProgress(0); }}
        className="hidden"
      />
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [waStatus, setWaStatus] = useState('disconnected');
  const [waError, setWaError] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [columns, setColumns] = useState<Column[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnColor, setNewColumnColor] = useState('#e2e8f0');
  
  const [searchQuery, setSearchQuery] = useState('');
  
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editColumnName, setEditColumnName] = useState('');
  const [editColumnColor, setEditColumnColor] = useState('#e2e8f0');

  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');
  
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const [editTagColor, setEditTagColor] = useState('#3b82f6');

  const [chatToTag, setChatToTag] = useState<string | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [isMediaGalleryOpen, setIsMediaGalleryOpen] = useState(false);
  const [storageSize, setStorageSize] = useState<number>(0);
  const [mediaFiles, setMediaFiles] = useState<any[]>([]);
  const [mediaSort, setMediaSort] = useState<'date' | 'size'>('date');
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [editingChatNameId, setEditingChatNameId] = useState<string | null>(null);
  const [editChatName, setEditChatName] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, selectedChat]);

  useEffect(() => {
    const savedPassword = localStorage.getItem('app_password') || sessionStorage.getItem('app_password');
    if (savedPassword) {
      setPassword(savedPassword);
      checkLogin(savedPassword);
    } else {
      // Try without password to see if it's required
      checkLogin('');
    }
  }, []);

  const checkLogin = async (pwd: string) => {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      if (res.ok) {
        setIsAuthenticated(true);
        if (rememberMe && pwd) localStorage.setItem('app_password', pwd);
        else if (pwd) sessionStorage.setItem('app_password', pwd);
      } else {
        setIsAuthenticated(false);
        localStorage.removeItem('app_password');
        sessionStorage.removeItem('app_password');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        setIsAuthenticated(true);
        setLoginError('');
        if (rememberMe) localStorage.setItem('app_password', password);
        else sessionStorage.setItem('app_password', password);
      } else {
        setLoginError('Senha incorreta');
      }
    } catch (e) {
      setLoginError('Erro ao conectar');
    }
  };

  const apiFetch = async (url: string, options: RequestInit = {}) => {
    const pwd = localStorage.getItem('app_password') || sessionStorage.getItem('app_password') || password;
    const headers = new Headers(options.headers || {});
    if (pwd) headers.set('x-app-password', pwd);
    
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      setIsAuthenticated(false);
      throw new Error('Unauthorized');
    }
    return res;
  };

  useEffect(() => {
    if (!isAuthenticated) return;

    fetchData();

    socket.on('wa_status', (data) => {
      setWaStatus(data.status);
      if (data.qr) setQrCode(data.qr);
      else setQrCode('');
      if (data.error) setWaError(data.error);
      else setWaError('');
    });

    socket.on('columns_updated', fetchData);
    socket.on('tags_updated', fetchData);
    socket.on('chat_updated', fetchData);
    socket.on('new_chat', fetchData);
    socket.on('chat_deleted', (data: { id: string }) => {
      if (selectedChat?.id === data.id) {
        setSelectedChat(null);
      }
      fetchData();
    });
    socket.on('chat_tags_updated', fetchData);

    socket.on('new_message', (msg: Message) => {
      if (selectedChat && msg.chat_id === selectedChat.id) {
        setMessages(prev => [...prev, msg]);
      }
      fetchData(); // Refresh chats list for last_message
    });

    return () => {
      socket.off('wa_status');
      socket.off('columns_updated');
      socket.off('tags_updated');
      socket.off('chat_updated');
      socket.off('new_chat');
      socket.off('chat_tags_updated');
      socket.off('new_message');
    };
  }, [selectedChat, isAuthenticated]);

  const fetchStorage = async () => {
    try {
      const res = await apiFetch('/api/system/storage');
      const data = await res.json();
      setStorageSize(data.total_bytes);
    } catch (e) {
      console.error('Error fetching storage size:', e);
    }
  };

  const fetchMedia = async () => {
    try {
      const res = await apiFetch('/api/media');
      const data = await res.json();
      setMediaFiles(data);
    } catch (e) {
      console.error('Error fetching media files:', e);
    }
  };

  const fetchData = async () => {
    try {
      const [colsRes, chatsRes, tagsRes, waRes] = await Promise.all([
        apiFetch('/api/columns'),
        apiFetch('/api/chats'),
        apiFetch('/api/tags'),
        apiFetch('/api/wa/status')
      ]);
      
      setColumns(await colsRes.json());
      setChats(await chatsRes.json());
      setTags(await tagsRes.json());
      
      const waData = await waRes.json();
      setWaStatus(waData.status);
      if (waData.qr) setQrCode(waData.qr);
      else setQrCode('');
      if (waData.error) setWaError(waData.error);
      else setWaError('');

      fetchStorage();
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const loadMessages = async (chatId: string) => {
    try {
      const res = await apiFetch(`/api/chats/${chatId}/messages`);
      setMessages(await res.json());
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const handleChatSelect = async (chat: Chat) => {
    setSelectedChat(chat);
    setIsRightSidebarOpen(true);
    if (chat.unread_count > 0) {
      try {
        await apiFetch(`/api/chats/${chat.id}/read`, { method: 'PUT' });
        setChats(prev => prev.map(c => c.id === chat.id ? { ...c, unread_count: 0 } : c));
      } catch (error) {
        console.error('Error marking chat as read:', error);
      }
    }
    loadMessages(chat.id);

    if (!chat.profile_pic && waStatus === 'connected') {
      apiFetch(`/api/chats/${chat.id}/sync-profile-pic`, { method: 'POST' }).catch(console.error);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    if (window.confirm('Tem certeza que deseja excluir esta conversa? Todos os dados serão perdidos.')) {
      try {
        await apiFetch(`/api/chats/${chatId}`, { method: 'DELETE' });
        if (selectedChat?.id === chatId) {
          setSelectedChat(null);
        }
        fetchData();
      } catch (error) {
        console.error('Error deleting chat:', error);
      }
    }
  };

  const handleDeleteMedia = async (mediaId: string) => {
    if (window.confirm('Tem certeza que deseja excluir este arquivo?')) {
      try {
        await apiFetch(`/api/media/${mediaId}`, { method: 'DELETE' });
        fetchMedia();
        fetchStorage();
      } catch (error) {
        console.error('Error deleting media:', error);
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChat) return;

    try {
      await apiFetch(`/api/chats/${selectedChat.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newMessage })
      });
      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!selectedChat) return;
    setUploadingMedia(true);
    
    const formData = new FormData();
    formData.append('media', file);
    if (newMessage.trim()) {
      formData.append('body', newMessage);
    }

    try {
      await apiFetch(`/api/chats/${selectedChat.id}/messages`, {
        method: 'POST',
        body: formData
      });
      setNewMessage('');
    } catch (error) {
      console.error('Error uploading file:', error);
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleAddColumn = async () => {
    if (!newColumnName.trim()) return;
    try {
      await apiFetch('/api/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'col-' + Date.now(),
          name: newColumnName,
          position: columns.length,
          color: newColumnColor
        })
      });
      setNewColumnName('');
      setNewColumnColor('#e2e8f0');
      setIsAddingColumn(false);
    } catch (error) {
      console.error('Error adding column:', error);
    }
  };

  const handleMoveChat = async (chatId: string, columnId: string) => {
    try {
      await apiFetch(`/api/chats/${chatId}/column`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column_id: columnId })
      });
    } catch (error) {
      console.error('Error moving chat:', error);
    }
  };

  const handleEditColumn = async (columnId: string) => {
    if (!editColumnName.trim()) return;
    try {
      const column = columns.find(c => c.id === columnId);
      if (!column) return;
      await apiFetch(`/api/columns/${columnId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editColumnName,
          position: column.position,
          color: editColumnColor
        })
      });
      setEditingColumnId(null);
    } catch (error) {
      console.error('Error editing column:', error);
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    if (columns.length <= 1) {
      alert('Não é possível excluir a última coluna.');
      return;
    }
    if (confirm('Tem certeza que deseja excluir esta coluna? Os chats serão movidos para outra coluna.')) {
      try {
        await apiFetch(`/api/columns/${columnId}`, { method: 'DELETE' });
        setEditingColumnId(null);
      } catch (error) {
        console.error('Error deleting column:', error);
      }
    }
  };

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    try {
      await apiFetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'tag-' + Date.now(),
          name: newTagName,
          color: newTagColor
        })
      });
      setNewTagName('');
      setIsAddingTag(false);
    } catch (error) {
      console.error('Error adding tag:', error);
    }
  };

  const handleEditTag = async (id: string) => {
    if (!editTagName.trim()) return;
    try {
      await apiFetch(`/api/tags/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editTagName,
          color: editTagColor
        })
      });
      setEditingTagId(null);
    } catch (error) {
      console.error('Error updating tag:', error);
    }
  };

  const handleDeleteTag = async (id: string) => {
    if (window.confirm('Tem certeza que deseja excluir esta tag? Ela será removida de todos os contatos.')) {
      try {
        await apiFetch(`/api/tags/${id}`, {
          method: 'DELETE'
        });
        setEditingTagId(null);
      } catch (error) {
        console.error('Error deleting tag:', error);
      }
    }
  };

  const handleAssignTag = async (chatId: string, tagId: string) => {
    try {
      await apiFetch(`/api/chats/${chatId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_id: tagId })
      });
      setChatToTag(null);
    } catch (error) {
      console.error('Error assigning tag:', error);
    }
  };

  const handleRemoveTag = async (chatId: string, tagId: string) => {
    try {
      await apiFetch(`/api/chats/${chatId}/tags/${tagId}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error('Error removing tag:', error);
    }
  };

  const handleEditChatName = async (chatId: string) => {
    if (!editChatName.trim()) return;
    try {
      await apiFetch(`/api/chats/${chatId}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editChatName })
      });
      setEditingChatNameId(null);
    } catch (error) {
      console.error('Error editing chat name:', error);
    }
  };

  const handleDragStart = (e: React.DragEvent, chatId: string) => {
    e.dataTransfer.setData('chatId', chatId);
  };

  const handleColumnDrop = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    const chatId = e.dataTransfer.getData('chatId');
    if (chatId) {
      handleMoveChat(chatId, columnId);
    }
  };

  const handleColumnDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleResetWa = async () => {
    if (confirm('Tem certeza que deseja desconectar o WhatsApp?')) {
      await apiFetch('/api/wa/reset', { method: 'POST' });
    }
  };

  const handleRestartWa = async () => {
    await apiFetch('/api/wa/restart', { method: 'POST' });
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 font-sans">
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-gray-200">
          <div className="flex items-center justify-center gap-3 mb-8">
            <MessageCircle className="text-green-500 w-10 h-10" />
            <h1 className="text-2xl font-bold text-gray-800">WhatsKanban</h1>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Senha de Acesso</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                placeholder="Insira a senha"
                required
              />
            </div>
            
            <div className="flex items-center">
              <input
                id="remember"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
              />
              <label htmlFor="remember" className="ml-2 block text-sm text-gray-700">
                Continuar conectado
              </label>
            </div>

            {loginError && <p className="text-red-500 text-sm font-medium">{loginError}</p>}
            
            <button
              type="submit"
              className="w-full bg-green-500 text-white font-semibold py-3 px-4 rounded-lg hover:bg-green-600 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
              Entrar
            </button>
          </form>
        </div>
      </div>
    );
  }

  const filteredChats = chats.filter(c => {
    const matchesTags = selectedTagFilters.length === 0 || selectedTagFilters.some(t => c.tag_ids.includes(t));
    const matchesSearch = searchQuery === '' || 
      (c.name && c.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.phone && c.phone.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.last_message && c.last_message.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesTags && matchesSearch;
  });

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden">
      {/* Sidebar / Settings */}
      {isSidebarOpen && (
        <div className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle className="text-green-500" />
              <h1 className="font-bold text-lg text-gray-800">WhatsKanban</h1>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="text-gray-500 hover:text-gray-700">
              <X size={20} />
            </button>
          </div>
          
          <div className="p-4 border-b border-gray-200">
            <input
              type="text"
              placeholder="Buscar chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          
          <div className="p-4 flex-1 overflow-y-auto">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Conexão WhatsApp</h2>
            
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Smartphone size={16} className={waStatus === 'connected' ? 'text-green-500' : waStatus === 'error' ? 'text-red-500' : 'text-gray-400'} />
                <span className="text-sm font-medium capitalize">{waStatus}</span>
              </div>
              
              {waError && (
                <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600 break-words">
                  {waError}
                </div>
              )}
              
              {waStatus === 'qr' && qrCode && (
                <div className="mt-2 flex flex-col items-center">
                  <img src={qrCode} alt="QR Code" className="w-full h-auto rounded-md border border-gray-200" />
                  <p className="text-xs text-gray-500 mt-2 text-center">Escaneie para conectar</p>
                </div>
              )}
              
              {waStatus === 'connected' && (
                <button 
                  onClick={handleResetWa}
                  className="mt-2 w-full flex items-center justify-center gap-1 text-xs text-red-600 bg-red-50 py-1.5 rounded hover:bg-red-100 transition-colors"
                >
                  <RefreshCw size={12} /> Desconectar
                </button>
              )}
              
              {(waStatus === 'error' || waStatus === 'disconnected') && (
                <button 
                  onClick={handleRestartWa}
                  className="mt-2 w-full flex items-center justify-center gap-1 text-xs text-blue-600 bg-blue-50 py-1.5 rounded hover:bg-blue-100 transition-colors"
                >
                  <RefreshCw size={12} /> Reiniciar Conexão
                </button>
              )}
            </div>

            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-6">Armazenamento</h2>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <HardDrive size={16} className="text-blue-500" />
                  <span className="text-sm font-medium">Espaço Usado</span>
                </div>
                <span className="text-sm font-bold text-gray-700">
                  {(storageSize / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
              <button 
                onClick={() => {
                  fetchMedia();
                  setIsMediaGalleryOpen(true);
                }}
                className="w-full mt-2 flex items-center justify-center gap-2 text-sm text-blue-600 bg-blue-50 py-2 rounded-md hover:bg-blue-100 transition-colors font-medium border border-blue-200"
              >
                <ImageIcon size={16} /> Galeria de Arquivos
              </button>
            </div>

            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-6">Filtro de Tags</h2>
            <div className="flex flex-wrap gap-1 mb-6">
              {tags.map(tag => {
                const isSelected = selectedTagFilters.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedTagFilters(prev => prev.filter(id => id !== tag.id));
                      } else {
                        setSelectedTagFilters(prev => [...prev, tag.id]);
                      }
                    }}
                    className={`text-xs px-2 py-1 rounded-full border flex items-center gap-1 transition-colors ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }}></div>
                    {tag.name}
                  </button>
                );
              })}
              {tags.length === 0 && <p className="text-xs text-gray-400 italic">Nenhuma tag criada</p>}
            </div>

            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Gerenciar Tags</h2>
            <div className="space-y-2">
              {tags.map(tag => (
                <div key={tag.id} className="flex items-center justify-between text-sm group">
                  {editingTagId === tag.id ? (
                    <div className="flex-1 flex flex-col gap-2 p-2 bg-gray-50 border border-gray-200 rounded-md">
                      <input
                        type="text"
                        value={editTagName}
                        onChange={(e) => setEditTagName(e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <input 
                          type="color" 
                          value={editTagColor} 
                          onChange={(e) => setEditTagColor(e.target.value)}
                          className="w-6 h-6 p-0 border-0 rounded cursor-pointer"
                        />
                        <span className="text-xs text-gray-500">Cor</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => handleEditTag(tag.id)} className="flex-1 bg-blue-600 text-white text-[10px] px-2 py-1 rounded hover:bg-blue-700">Salvar</button>
                        <button onClick={() => setEditingTagId(null)} className="flex-1 bg-gray-200 text-gray-700 text-[10px] px-2 py-1 rounded hover:bg-gray-300">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }}></div>
                        <span>{tag.name}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setEditingTagId(tag.id);
                            setEditTagName(tag.name);
                            setEditTagColor(tag.color);
                          }}
                          className="text-gray-400 hover:text-blue-500 p-1"
                          title="Editar tag"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button 
                          onClick={() => handleDeleteTag(tag.id)}
                          className="text-gray-400 hover:text-red-500 p-1"
                          title="Excluir tag"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              
              {isAddingTag ? (
                <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded-md">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Nome da tag"
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs mb-2 focus:outline-none focus:border-blue-500"
                    autoFocus
                  />
                  <div className="flex items-center gap-2 mb-2">
                    <input 
                      type="color" 
                      value={newTagColor} 
                      onChange={(e) => setNewTagColor(e.target.value)}
                      className="w-6 h-6 p-0 border-0 rounded cursor-pointer"
                    />
                    <span className="text-xs text-gray-500">Cor</span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={handleAddTag} className="flex-1 bg-blue-600 text-white text-[10px] px-2 py-1 rounded hover:bg-blue-700">Salvar</button>
                    <button onClick={() => setIsAddingTag(false)} className="flex-1 bg-gray-200 text-gray-700 text-[10px] px-2 py-1 rounded hover:bg-gray-300">Cancelar</button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => setIsAddingTag(true)}
                  className="text-xs text-blue-600 flex items-center gap-1 hover:underline mt-2"
                >
                  <Plus size={12} /> Nova Tag
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-2 border-b border-gray-200 bg-white flex items-center justify-between">
          <div className="flex items-center">
            {!isSidebarOpen && (
              <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-md">
                <Menu size={20} />
              </button>
            )}
            <div className={`${!isSidebarOpen ? 'ml-4' : 'ml-2'} flex items-center gap-2`}>
              <MessageCircle className="text-green-500" size={20} />
              <h1 className="font-bold text-gray-800">WhatsKanban</h1>
            </div>
          </div>
          {selectedChat && !isRightSidebarOpen && (
            <button 
              onClick={() => setIsRightSidebarOpen(true)} 
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-md flex items-center gap-2"
              title="Mostrar painel do chat"
            >
              <span className="text-sm font-medium">{selectedChat.name || selectedChat.phone}</span>
              <Menu size={20} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-x-auto p-6 flex gap-6">
        {columns.map(column => (
          <div 
            key={column.id} 
            className="flex-shrink-0 w-80 bg-gray-50 rounded-xl border border-gray-200 flex flex-col max-h-full overflow-hidden shadow-sm"
            onDrop={(e) => handleColumnDrop(e, column.id)}
            onDragOver={handleColumnDragOver}
          >
            <div 
              className="p-3 border-b border-gray-200 flex justify-between items-center bg-gray-100 group"
              style={{ borderTop: `4px solid ${column.color || '#e2e8f0'}` }}
            >
              {editingColumnId === column.id ? (
                <div className="flex-1 flex flex-col gap-2">
                  <input
                    type="text"
                    value={editColumnName}
                    onChange={(e) => setEditColumnName(e.target.value)}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleEditColumn(column.id)}
                  />
                  <div className="flex items-center gap-2">
                    <input 
                      type="color" 
                      value={editColumnColor} 
                      onChange={(e) => setEditColumnColor(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                    />
                    <button onClick={() => handleEditColumn(column.id)} className="text-blue-600 text-xs font-medium bg-blue-50 px-2 py-1 rounded">Salvar</button>
                    <button onClick={() => setEditingColumnId(null)} className="text-gray-500 text-xs font-medium bg-gray-100 px-2 py-1 rounded">Cancelar</button>
                    <button onClick={() => handleDeleteColumn(column.id)} className="text-red-600 text-xs font-medium bg-red-50 px-2 py-1 rounded ml-auto" title="Excluir Coluna">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <h3 
                  className="font-semibold text-gray-700 flex-1 cursor-pointer hover:text-blue-600 flex items-center gap-2"
                  onClick={() => {
                    setEditingColumnId(column.id);
                    setEditColumnName(column.name);
                    setEditColumnColor(column.color || '#e2e8f0');
                  }}
                  title="Clique para editar"
                >
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: column.color || '#e2e8f0' }}></span>
                  {column.name}
                </h3>
              )}
              <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-full font-medium ml-2">
                {filteredChats.filter(c => c.column_id === column.id).length}
              </span>
            </div>
            
            <div className="p-3 flex-1 overflow-y-auto space-y-3">
              {filteredChats.filter(c => c.column_id === column.id).map(chat => (
                <div 
                  key={chat.id} 
                  onClick={() => handleChatSelect(chat)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, chat.id)}
                  className={`group bg-white p-3 rounded-lg shadow-sm border cursor-pointer hover:shadow-md transition-shadow ${selectedChat?.id === chat.id ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2 overflow-hidden">
                      {chat.profile_pic ? (
                        <img 
                          src={chat.profile_pic} 
                          alt="" 
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0" 
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                            if (waStatus === 'connected' && !e.currentTarget.dataset.retried) {
                              e.currentTarget.dataset.retried = 'true';
                              apiFetch(`/api/chats/${chat.id}/sync-profile-pic`, { method: 'POST' }).catch(console.error);
                            }
                          }}
                        />
                      ) : null}
                      <div className={`w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 flex-shrink-0 ${chat.profile_pic ? 'hidden' : ''}`}>
                        {chat.name ? chat.name.charAt(0).toUpperCase() : '?'}
                      </div>
                      {editingChatNameId === chat.id ? (
                        <input
                          type="text"
                          value={editChatName}
                          onChange={(e) => setEditChatName(e.target.value)}
                          onBlur={() => handleEditChatName(chat.id)}
                          onKeyDown={(e) => e.key === 'Enter' && handleEditChatName(chat.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-gray-900 border-b border-blue-500 focus:outline-none w-full"
                          autoFocus
                        />
                      ) : (
                        <h4 className="font-medium text-gray-900 truncate pr-2 flex items-center gap-1 group/name">
                          {chat.name || chat.phone}
                          <button 
                            onClick={(e) => { e.stopPropagation(); setEditingChatNameId(chat.id); setEditChatName(chat.name || chat.phone); }}
                            className="opacity-0 group-hover/name:opacity-100 text-gray-400 hover:text-blue-500 transition-opacity"
                          >
                            <Edit2 size={12} />
                          </button>
                        </h4>
                      )}
                    </div>
                    {chat.unread_count > 0 && (
                      <span className="bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
                        {chat.unread_count}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate mb-2">{chat.last_message}</p>
                  
                  <div className="flex justify-between items-center mt-2">
                    <div className="flex flex-wrap gap-1">
                      {chat.tag_ids.map(tagId => {
                        const tag = tags.find(t => t.id === tagId);
                        if (!tag) return null;
                        return (
                          <div key={tagId} className="flex items-center gap-1 bg-gray-100 px-1.5 py-0.5 rounded text-[10px] text-gray-600 group/tag">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                            <span>{tag.name}</span>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleRemoveTag(chat.id, tagId); }}
                              className="opacity-0 group-hover/tag:opacity-100 text-gray-400 hover:text-red-500 ml-0.5"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className="text-[10px] text-gray-400">
                        {chat.last_message_time ? format(new Date(chat.last_message_time), 'HH:mm') : ''}
                      </span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id); }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity"
                        title="Excluir conversa"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Add Column Button */}
        <div className="flex-shrink-0 w-80">
          {isAddingColumn ? (
            <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
              <input
                type="text"
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                placeholder="Nome da coluna"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-2 focus:outline-none focus:border-blue-500"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAddColumn()}
              />
              <div className="flex items-center gap-2 mb-2">
                <label className="text-xs text-gray-500">Cor:</label>
                <input 
                  type="color" 
                  value={newColumnColor} 
                  onChange={(e) => setNewColumnColor(e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddColumn} className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded hover:bg-blue-700">Salvar</button>
                <button onClick={() => setIsAddingColumn(false)} className="bg-gray-100 text-gray-600 text-xs px-3 py-1.5 rounded hover:bg-gray-200">Cancelar</button>
              </div>
            </div>
          ) : (
            <button 
              onClick={() => setIsAddingColumn(true)}
              className="w-full flex items-center justify-center gap-2 bg-gray-50 border-2 border-dashed border-gray-300 text-gray-500 rounded-xl py-4 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <Plus size={20} /> Adicionar Coluna
            </button>
          )}
        </div>
      </div>
    </div>

    {/* Chat Panel */}
      {selectedChat && isRightSidebarOpen && (
        <div className="w-96 bg-white border-l border-gray-200 flex flex-col shadow-xl z-10">
          <div className="p-4 border-b border-gray-200 flex flex-col bg-gray-50">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-3">
                {selectedChat.profile_pic ? (
                  <img 
                    src={selectedChat.profile_pic} 
                    alt="" 
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0" 
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      if (waStatus === 'connected' && !e.currentTarget.dataset.retried) {
                        e.currentTarget.dataset.retried = 'true';
                        apiFetch(`/api/chats/${selectedChat.id}/sync-profile-pic`, { method: 'POST' }).catch(console.error);
                      }
                    }}
                  />
                ) : null}
                <div className={`w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 flex-shrink-0 ${selectedChat.profile_pic ? 'hidden' : ''}`}>
                  {selectedChat.name ? selectedChat.name.charAt(0).toUpperCase() : '?'}
                </div>
                <div>
                  <h3 className="font-bold text-gray-800">{selectedChat.name || selectedChat.phone}</h3>
                  <p className="text-xs text-gray-500">{selectedChat.phone}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => handleDeleteChat(selectedChat.id)} 
                  className="text-red-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50 transition-colors" 
                  title="Excluir conversa"
                >
                  <Trash2 size={20} />
                </button>
                <button onClick={() => setIsRightSidebarOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100 transition-colors" title="Ocultar painel">
                  <Menu size={20} />
                </button>
                <button onClick={() => setSelectedChat(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100 transition-colors" title="Fechar chat">
                  <X size={20} />
                </button>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-1 items-center">
              {selectedChat.tag_ids.map(tagId => {
                const tag = tags.find(t => t.id === tagId);
                if (!tag) return null;
                return (
                  <span key={tagId} className="text-[10px] px-2 py-0.5 rounded-full text-white flex items-center gap-1" style={{ backgroundColor: tag.color }}>
                    {tag.name}
                  </span>
                );
              })}
              
              <div className="relative">
                <button 
                  onClick={() => setChatToTag(chatToTag === selectedChat.id ? null : selectedChat.id)}
                  className="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full hover:bg-gray-300 flex items-center gap-1"
                >
                  <Plus size={10} /> Add Tag
                </button>
                
                {chatToTag === selectedChat.id && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 shadow-lg rounded-md p-2 w-48 z-20">
                    <h4 className="text-xs font-semibold text-gray-500 mb-2">Selecione uma Tag</h4>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {tags.filter(t => !selectedChat.tag_ids.includes(t.id)).map(tag => (
                        <button
                          key={tag.id}
                          onClick={() => handleAssignTag(selectedChat.id, tag.id)}
                          className="w-full text-left text-xs px-2 py-1 hover:bg-gray-100 rounded flex items-center gap-2"
                        >
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }}></div>
                          {tag.name}
                        </button>
                      ))}
                      {tags.filter(t => !selectedChat.tag_ids.includes(t.id)).length === 0 && (
                        <p className="text-xs text-gray-400 italic">Nenhuma tag disponível</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#e5ddd5]" onDrop={handleDrop} onDragOver={handleDragOver}>
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg p-2 text-sm shadow-sm ${msg.from_me ? 'bg-[#dcf8c6] text-gray-800' : 'bg-white text-gray-800'}`}>
                  {msg.media_url && (
                    <div className="mb-2">
                      {msg.media_type?.startsWith('image/') ? (
                        <img src={msg.media_url} alt="Media" className="max-w-full rounded-md max-h-64 object-contain" />
                      ) : (msg.media_type?.startsWith('audio/') || msg.media_type?.includes('ogg')) ? (
                        <div className="flex flex-col gap-2">
                          <AudioPlayer src={msg.media_url} />
                          {msg.transcription && (
                            <div className="bg-white/50 p-2 rounded text-xs italic border border-gray-200">
                              <span className="font-semibold not-italic text-gray-600 block mb-1">Transcrição:</span>
                              {msg.transcription}
                            </div>
                          )}
                        </div>
                      ) : msg.media_type?.startsWith('video/') ? (
                        <video controls src={msg.media_url} className="max-w-full rounded-md max-h-64" />
                      ) : (
                        <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-black/5 p-2 rounded hover:bg-black/10 transition-colors">
                          <span className="text-2xl">📄</span>
                          <span className="truncate max-w-[200px]">{msg.media_name || 'Documento'}</span>
                        </a>
                      )}
                    </div>
                  )}
                  {msg.body && <p className="whitespace-pre-wrap">{msg.body}</p>}
                  <span className="text-[10px] text-gray-500 block text-right mt-1">
                    {format(new Date(msg.timestamp), 'HH:mm')}
                  </span>
                </div>
              </div>
            ))}
            {uploadingMedia && (
              <div className="flex justify-end">
                <div className="bg-[#dcf8c6] text-gray-800 max-w-[80%] rounded-lg p-2 text-sm shadow-sm italic opacity-70">
                  Enviando arquivo...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          
          <div className="p-3 border-t border-gray-200 bg-gray-50 relative">
            {uploadingMedia && (
              <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-500"></div>
              </div>
            )}
            <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
              <label className="cursor-pointer text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200 transition-colors">
                <Plus size={20} />
                <input 
                  type="file" 
                  className="hidden" 
                  onChange={(e) => e.target.files && e.target.files.length > 0 && handleFileUpload(e.target.files[0])}
                  disabled={uploadingMedia || waStatus !== 'connected'}
                />
              </label>
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Digite uma mensagem ou arraste um arquivo..."
                className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                disabled={uploadingMedia || waStatus !== 'connected'}
              />
              <button 
                type="submit"
                disabled={(!newMessage.trim() && !uploadingMedia) || waStatus !== 'connected'}
                className="bg-green-500 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"></path></svg>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Media Gallery Modal */}
      {isMediaGalleryOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ImageIcon className="text-blue-500" />
                <h2 className="text-lg font-bold text-gray-800">Galeria de Arquivos</h2>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Ordenar por:</span>
                  <select 
                    value={mediaSort} 
                    onChange={(e) => setMediaSort(e.target.value as 'date' | 'size')}
                    className="border border-gray-300 rounded px-2 py-1"
                  >
                    <option value="date">Mais recentes</option>
                    <option value="size">Maior tamanho</option>
                  </select>
                </div>
                <button onClick={() => setIsMediaGalleryOpen(false)} className="text-gray-500 hover:text-gray-700">
                  <X size={24} />
                </button>
              </div>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto bg-gray-50">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {[...mediaFiles].sort((a, b) => {
                  if (mediaSort === 'date') return b.timestamp - a.timestamp;
                  return b.size - a.size;
                }).map(file => (
                  <div key={file.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                    <div className="h-32 bg-gray-100 flex items-center justify-center relative group">
                      {file.media_type?.startsWith('image/') ? (
                        <img src={file.media_url} alt={file.media_name} className="w-full h-full object-cover" />
                      ) : file.media_type?.startsWith('video/') ? (
                        <video src={file.media_url} className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center text-gray-400">
                          <HardDrive size={32} className="mb-2" />
                          <span className="text-xs font-medium px-2 text-center break-all line-clamp-2">{file.media_name}</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <a href={file.media_url} download={file.media_name} target="_blank" rel="noreferrer" className="bg-white text-gray-800 p-2 rounded-full hover:bg-blue-50 transition-colors" title="Baixar">
                          <Download size={20} />
                        </a>
                        <button 
                          onClick={() => handleDeleteMedia(file.id)}
                          className="bg-white text-red-500 p-2 rounded-full hover:bg-red-50 transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="text-xs font-semibold text-gray-800 truncate" title={file.chat_name || file.chat_phone}>
                        {file.chat_name || file.chat_phone}
                      </p>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-[10px] text-gray-500">
                          {format(new Date(file.timestamp), "dd/MM/yy HH:mm")}
                        </span>
                        <span className="text-[10px] font-medium bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                          {(file.size / (1024 * 1024)).toFixed(2)} MB
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                
                {mediaFiles.length === 0 && (
                  <div className="col-span-full py-12 flex flex-col items-center justify-center text-gray-500">
                    <ImageIcon size={48} className="text-gray-300 mb-4" />
                    <p>Nenhum arquivo encontrado</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

