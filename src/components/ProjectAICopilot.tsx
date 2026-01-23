
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Project, ProjectStep, ProjectDocument, Supplier } from '../types';
import { Sparkles, Send, X, Loader2, Bot, ChevronDown, User, FileText } from 'lucide-react';

interface Props {
  project: Project;
  supplier: Supplier | null;
  steps: ProjectStep[];
  docs: ProjectDocument[];
}

interface Message {
  role: 'user' | 'model';
  text: string;
}

export const ProjectAICopilot: React.FC<Props> = ({ project, supplier, steps, docs }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: `Hi! I'm your OriginFlow assistant for **${project.name}**. I can help you draft supplier emails, summarize status, or identify risks. How can I help?` }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen, isMinimized]);

  const buildContext = () => {
    const stepsStatus = steps.map(s => `- Step ${s.stepNumber} (${s.name}): ${s.status}`).join('\n');
    const docsStatus = docs.map(d => `- ${d.title}: ${d.status} (Due: ${d.deadline || 'N/A'})`).join('\n');
    
    return `
      Current Project: ${project.name} (ID: ${project.projectId})
      Supplier: ${supplier?.name || 'Unassigned'}
      
      Project Milestones:
      ${JSON.stringify(project.milestones || {}, null, 2)}
      
      Steps Status:
      ${stepsStatus}
      
      Documents Status:
      ${docsStatus}
    `;
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
      const context = buildContext();
      
      const systemInstruction = `You are an expert Project Management assistant for a product launch platform called OriginFlow. 
      You are assisting a PM with the project described below. 
      Be concise, professional, and helpful. 
      When drafting emails, use placeholders like [Name] where necessary.
      
      CONTEXT:
      ${context}`;

      // Complex Reasoning Task: Use gemini-3-pro-preview
      const chat = ai.chats.create({
        model: 'gemini-3-pro-preview',
        config: { systemInstruction },
        history: messages.map(m => ({ role: m.role, parts: [{ text: m.text }] }))
      });

      const result = await chat.sendMessage({ message: userMsg });
      const responseText = result.text;

      setMessages(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (error: any) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', text: "I'm sorry, I encountered an error connecting to the AI service. Please check your API key configuration." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderText = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-gradient-to-r from-indigo-600 to-indigo-600 text-white p-4 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all z-40 flex items-center gap-2 group"
      >
        <Sparkles size={24} className="group-hover:animate-pulse" />
        <span className="font-bold pr-1">AI Copilot</span>
      </button>
    );
  }

  return (
    <div className={`fixed bottom-6 right-6 w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 z-40 flex flex-col transition-all duration-300 ${isMinimized ? 'h-16' : 'h-[600px]'}`}>
      <div 
        className="bg-gradient-to-r from-indigo-600 to-indigo-600 p-4 rounded-t-2xl flex justify-between items-center cursor-pointer"
        onClick={() => setIsMinimized(!isMinimized)}
      >
        <div className="flex items-center gap-2 text-white">
          <Bot size={20} />
          <h3 className="font-bold text-sm">OriginFlow AI Pro</h3>
        </div>
        <div className="flex items-center gap-2 text-white/80">
          <button onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }} className="hover:text-white">
            <ChevronDown size={18} className={`transition-transform ${isMinimized ? 'rotate-180' : ''}`} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} className="hover:text-white">
            <X size={18} />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          <div className="flex-1 overflow-y-auto p-4 bg-light space-y-4" ref={scrollRef}>
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-gray-200 text-gray-600' : 'bg-indigo-100 text-indigo-600'}`}>
                  {msg.role === 'user' ? <User size={14} /> : <Sparkles size={14} />}
                </div>
                <div className={`p-3 rounded-xl text-sm max-w-[80%] whitespace-pre-wrap ${
                  msg.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-tr-none' 
                    : 'bg-white border border-gray-200 text-gray-700 rounded-tl-none shadow'
                }`}>
                  {renderText(msg.text)}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                 <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                    <Sparkles size={14} />
                 </div>
                 <div className="bg-white border border-gray-200 p-3 rounded-xl rounded-tl-none shadow flex items-center gap-2 text-muted text-sm">
                    <Loader2 size={14} className="animate-spin" /> Analyzing context...
                 </div>
              </div>
            )}
          </div>

          <div className="p-4 bg-white border-t border-gray-100 rounded-b-2xl">
            <div className="relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about status, draft emails..."
                className="w-full pr-10 pl-4 py-3 bg-light border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white text-sm resize-none"
                rows={1}
                style={{ minHeight: '44px', maxHeight: '120px' }}
              />
              <button 
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                <Send size={14} />
              </button>
            </div>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
               <button onClick={() => setInput("Summarize current project status")} className="text-[10px] whitespace-nowrap px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md transition-colors border border-gray-200">
                  Summarize Status
               </button>
               <button onClick={() => setInput("Draft an email to supplier about missing documents")} className="text-[10px] whitespace-nowrap px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md transition-colors border border-gray-200">
                  Draft Follow-up
               </button>
               <button onClick={() => setInput("Identify potential risks based on deadlines")} className="text-[10px] whitespace-nowrap px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md transition-colors border border-gray-200">
                  Identify Risks
               </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
