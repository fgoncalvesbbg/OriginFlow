
import React, { useState, useEffect, useRef } from 'react';
import { getDocumentComments, addDocumentComment } from '../services/apiService';
import { DocumentComment } from '../types';
import { MessageSquare, Send, X, Loader2 } from 'lucide-react';

interface DocumentChatProps {
  documentId: string;
  documentTitle: string;
  isOpen: boolean;
  onClose: () => void;
  currentUser: {
    name: string;
    role: string;
  };
}

const DocumentChat: React.FC<DocumentChatProps> = ({ documentId, documentTitle, isOpen, onClose, currentUser }) => {
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && documentId) {
      loadComments();
    }
  }, [isOpen, documentId]);

  const loadComments = async () => {
    setLoading(true);
    try {
      const data = await getDocumentComments(documentId);
      setComments(data);
    } catch (e) {
      console.error("Failed to load comments", e);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;

    setSending(true);
    try {
      const newComment = await addDocumentComment(documentId, input, currentUser.name, currentUser.role);
      setComments([...comments, newComment]);
      setInput('');
      scrollToBottom();
    } catch (e) {
      console.error("Failed to send comment", e);
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-0 right-4 w-80 bg-white border border-gray-200 shadow-xl rounded-t-lg z-50 flex flex-col" style={{ height: '450px' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-indigo-600 text-white rounded-t-lg cursor-pointer" onClick={onClose}>
        <div className="flex items-center gap-2">
           <MessageSquare size={18} />
           <div className="flex flex-col">
             <span className="text-sm font-bold truncate max-w-[180px]">Chat: {documentTitle}</span>
           </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="hover:text-indigo-200"><X size={18} /></button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 bg-light space-y-3">
        {loading ? (
           <div className="flex justify-center p-4"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
        ) : comments.length === 0 ? (
           <div className="text-center text-xs text-gray-400 mt-10">No comments yet. Start the discussion!</div>
        ) : (
           comments.map(comment => {
             const isMe = comment.authorName === currentUser.name;
             return (
               <div key={comment.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div className={`flex items-end gap-2 max-w-[85%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                     <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center shrink-0 text-xs font-bold text-gray-600">
                        {comment.authorName.charAt(0)}
                     </div>
                     <div className={`p-2 rounded-xl text-sm ${isMe ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white border border-gray-200 text-gray-700 rounded-tl-none'}`}>
                        {comment.content}
                     </div>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1 px-9">
                     {comment.authorName} • {new Date(comment.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </div>
               </div>
             );
           })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSend} className="p-3 bg-white border-t border-gray-200">
         <div className="relative">
            <input 
               type="text" 
               className="w-full border border-gray-300 rounded-full py-2 pl-4 pr-10 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
               placeholder="Type a message..."
               value={input}
               onChange={(e) => setInput(e.target.value)}
            />
            <button 
               type="submit" 
               disabled={!input.trim() || sending}
               className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
               {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
         </div>
      </form>
    </div>
  );
};

export default DocumentChat;
