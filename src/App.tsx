import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { QrCode, Smartphone, RefreshCw, Plus, MessageCircle, Settings, Tag as TagIcon } from 'lucide-react';
import { Column, Chat, Tag, Message } from './types';
import { format } from 'date-fns';

const socket = io('/', { transports: ['websocket', 'polling'] });

export default function App() {
  const [waStatus, setWaStatus] = useState('disconnected');
  const [qrCode, setQrCode] = useState('');
  const [columns, setColumns] = useState<Column[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');

  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editColumnName, setEditColumnName] = useState('');

  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');

  const [chatToTag, setChatToTag] = useState<string | null>(null);

  useEffect(() => {
    fetchData();

    socket.on('wa_status', (data) => {
      setWaStatus(data.status);
      if (data.qr) setQrCode(data.qr);
      else setQrCode('');
    });

    socket.on('columns_updated', fetchData);
    socket.on('tags_updated', fetchData);
    socket.on('chat_updated', fetchData);
    socket.on('new_chat', fetchData);
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
  }, [selectedChat]);

  const fetchData = async () => {
    try {
      const [colsRes, chatsRes, tagsRes, waRes] = await Promise.all([
        fetch('/api/columns'),
        fetch('/api/chats'),
        fetch('/api/tags'),
        fetch('/api/wa/status')
      ]);
      
      setColumns(await colsRes.json());
      setChats(await chatsRes.json());
      setTags(await tagsRes.json());
      
      const waData = await waRes.json();
      setWaStatus(waData.status);
      if (waData.qr) setQrCode(waData.qr);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const loadMessages = async (chatId: string) => {
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`);
      setMessages(await res.json());
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const handleChatSelect = (chat: Chat) => {
    setSelectedChat(chat);
    loadMessages(chat.id);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChat) return;

    try {
      await fetch(`/api/chats/${selectedChat.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newMessage })
      });
      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleAddColumn = async () => {
    if (!newColumnName.trim()) return;
    try {
      await fetch('/api/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'col-' + Date.now(),
          name: newColumnName,
          position: columns.length
        })
      });
      setNewColumnName('');
      setIsAddingColumn(false);
    } catch (error) {
      console.error('Error adding column:', error);
    }
  };

  const handleMoveChat = async (chatId: string, columnId: string) => {
    try {
      await fetch(`/api/chats/${chatId}/column`, {
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
      await fetch(`/api/columns/${columnId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editColumnName,
          position: column.position
        })
      });
      setEditingColumnId(null);
    } catch (error) {
      console.error('Error editing column:', error);
    }
  };

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    try {
      await fetch('/api/tags', {
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

  const handleAssignTag = async (chatId: string, tagId: string) => {
    try {
      await fetch(`/api/chats/${chatId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_id: tagId })
      });
      setChatToTag(null);
    } catch (error) {
      console.error('Error assigning tag:', error);
    }
  };

  const handleResetWa = async () => {
    if (confirm('Tem certeza que deseja desconectar o WhatsApp?')) {
      await fetch('/api/wa/reset', { method: 'POST' });
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 font-sans">
      {/* Sidebar / Settings */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center gap-2">
          <MessageCircle className="text-green-500" />
          <h1 className="font-bold text-lg text-gray-800">WhatsKanban</h1>
        </div>
        
        <div className="p-4 flex-1">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Conexão WhatsApp</h2>
          
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Smartphone size={16} className={waStatus === 'connected' ? 'text-green-500' : 'text-gray-400'} />
              <span className="text-sm font-medium capitalize">{waStatus}</span>
            </div>
            
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
          </div>

          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-6">Tags</h2>
          <div className="space-y-2">
            {tags.map(tag => (
              <div key={tag.id} className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }}></div>
                <span>{tag.name}</span>
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

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto p-6 flex gap-6">
        {columns.map(column => (
          <div key={column.id} className="flex-shrink-0 w-80 bg-gray-50 rounded-xl border border-gray-200 flex flex-col max-h-full">
            <div className="p-3 border-b border-gray-200 flex justify-between items-center bg-gray-100 rounded-t-xl group">
              {editingColumnId === column.id ? (
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={editColumnName}
                    onChange={(e) => setEditColumnName(e.target.value)}
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleEditColumn(column.id)}
                  />
                  <button onClick={() => handleEditColumn(column.id)} className="text-blue-600 text-xs font-medium">OK</button>
                </div>
              ) : (
                <h3 
                  className="font-semibold text-gray-700 flex-1 cursor-pointer hover:text-blue-600"
                  onClick={() => {
                    setEditingColumnId(column.id);
                    setEditColumnName(column.name);
                  }}
                  title="Clique para editar"
                >
                  {column.name}
                </h3>
              )}
              <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-full font-medium ml-2">
                {chats.filter(c => c.column_id === column.id).length}
              </span>
            </div>
            
            <div className="p-3 flex-1 overflow-y-auto space-y-3">
              {chats.filter(c => c.column_id === column.id).map(chat => (
                <div 
                  key={chat.id} 
                  onClick={() => handleChatSelect(chat)}
                  className={`bg-white p-3 rounded-lg shadow-sm border cursor-pointer hover:shadow-md transition-shadow ${selectedChat?.id === chat.id ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="font-medium text-gray-900 truncate pr-2">{chat.name || chat.phone}</h4>
                    {chat.unread_count > 0 && (
                      <span className="bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {chat.unread_count}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate mb-2">{chat.last_message}</p>
                  
                  <div className="flex justify-between items-center mt-2">
                    <div className="flex gap-1">
                      {chat.tag_ids.map(tagId => {
                        const tag = tags.find(t => t.id === tagId);
                        if (!tag) return null;
                        return <div key={tagId} className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} title={tag.name} />
                      })}
                    </div>
                    <span className="text-[10px] text-gray-400">
                      {chat.last_message_time ? format(new Date(chat.last_message_time), 'HH:mm') : ''}
                    </span>
                  </div>

                  {/* Quick move buttons */}
                  <div className="mt-3 pt-2 border-t border-gray-100 flex gap-1 overflow-x-auto pb-1 no-scrollbar">
                    {columns.filter(c => c.id !== column.id).map(c => (
                      <button
                        key={c.id}
                        onClick={(e) => { e.stopPropagation(); handleMoveChat(chat.id, c.id); }}
                        className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded whitespace-nowrap"
                      >
                        {c.name}
                      </button>
                    ))}
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

      {/* Chat Panel */}
      {selectedChat && (
        <div className="w-96 bg-white border-l border-gray-200 flex flex-col shadow-xl z-10">
          <div className="p-4 border-b border-gray-200 flex flex-col bg-gray-50">
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="font-bold text-gray-800">{selectedChat.name || selectedChat.phone}</h3>
                <p className="text-xs text-gray-500">{selectedChat.phone}</p>
              </div>
              <button onClick={() => setSelectedChat(null)} className="text-gray-400 hover:text-gray-600">
                &times;
              </button>
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
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#e5ddd5]">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg p-2 text-sm shadow-sm ${msg.from_me ? 'bg-[#dcf8c6] text-gray-800' : 'bg-white text-gray-800'}`}>
                  <p>{msg.body}</p>
                  <span className="text-[10px] text-gray-500 block text-right mt-1">
                    {format(new Date(msg.timestamp), 'HH:mm')}
                  </span>
                </div>
              </div>
            ))}
          </div>
          
          <div className="p-3 border-t border-gray-200 bg-gray-50">
            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Digite uma mensagem..."
                className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
              />
              <button 
                type="submit"
                disabled={!newMessage.trim() || waStatus !== 'connected'}
                className="bg-green-500 text-white rounded-full w-10 h-10 flex items-center justify-center hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"></path></svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

