
import React, { useState } from 'react';
import Layout from '../components/Layout';
import { triggerEmailNotification } from '../services/apiService';
import { ArrowLeft, Mail, Send, Loader2, CheckCircle, AlertTriangle, Code, Terminal, ServerCrash, Key, ExternalLink, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const AdminTestEmail: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    to: '',
    subject: 'OriginFlow Test Notification',
    message: 'This is a test email from your OriginFlow PLM platform. We have upgraded to Resend API for better stability.'
  });

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(null);
    setError(null);

    try {
      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #0f172a; padding: 20px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 20px;">OriginFlow Notification</h1>
          </div>
          <div style="padding: 30px; color: #334155;">
            <h2 style="color: #0f172a; font-size: 18px; margin-top: 0;">Edge Function Test</h2>
            <p style="line-height: 1.6; font-size: 14px;">${formData.message}</p>
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center;">
              Sent via <strong>Resend API</strong> & Supabase Edge Functions.
            </div>
          </div>
        </div>
      `;

      await triggerEmailNotification({
        to: formData.to,
        subject: formData.subject,
        html: html,
        type: 'test'
      });

      setSuccess(`Test email successfully triggered to ${formData.to}`);
    } catch (e: any) {
      setError(e.message || "Unknown error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <button onClick={() => navigate('/admin')} className="flex items-center text-muted hover:text-gray-800 mb-6 text-sm">
          <ArrowLeft size={16} className="mr-1" /> Back to Admin Panel
        </button>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
             <h1 className="text-3xl font-bold text-primary">Email Notification Test</h2>
             <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Zap size={10} /> RESEND API
             </span>
          </div>
          <p className="text-muted">The system has been upgraded to use HTTP-based mailing for high reliability.</p>
        </div>

        {/* Success Banner */}
        {success && (
          <div className="mb-6 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center gap-3 animate-in fade-in">
            <CheckCircle size={20} className="shrink-0" />
            <p className="text-sm font-medium">{success}</p>
          </div>
        )}

        {/* Error Troubleshooting UI */}
        {error && (
          <div className="mb-8 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl overflow-hidden animate-in fade-in slide-in-from-top-2">
            <div className="p-4 bg-rose-100 border-b border-rose-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <ServerCrash size={20} className="text-rose-600" />
                    <h3 className="font-bold text-sm">Migration Required</h3>
                </div>
            </div>
            <div className="p-6">
                <p className="text-sm font-medium mb-4 text-red-900 flex items-center gap-2">
                    <AlertTriangle size={16} /> 
                    Configuration Error Detected
                </p>
                <p className="text-sm text-rose-700 mb-6 leading-relaxed">
                    Please ensure your Resend API Key is set correctly in Supabase.
                </p>
            </div>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl shadow overflow-hidden">
          <div className="bg-light border-b border-gray-200 px-8 py-3 flex items-center gap-2">
              <Terminal size={14} className="text-gray-400" />
              <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Test Configuration</span>
          </div>
          <form onSubmit={handleSendTest} className="p-8 space-y-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5 uppercase tracking-wide text-xs">Recipient Email</label>
              <input 
                required 
                type="email" 
                className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="you@example.com"
                value={formData.to}
                onChange={e => setFormData({...formData, to: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5 uppercase tracking-wide text-xs">Subject</label>
              <input 
                required 
                className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                value={formData.subject}
                onChange={e => setFormData({...formData, subject: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5 uppercase tracking-wide text-xs">Test Message Body</label>
              <textarea 
                required 
                rows={4}
                className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                value={formData.message}
                onChange={e => setFormData({...formData, message: e.target.value})}
              />
            </div>

            <div className="pt-2">
              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-indigo-100 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : <><Send size={18} /> Send via Resend API</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
};

export default AdminTestEmail;
