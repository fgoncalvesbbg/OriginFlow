import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getComplianceRequestsBySupplierId, getCategories } from '../../services/apiService';
import { ComplianceRequest, CategoryL3, ComplianceRequestStatus } from '../../types';
import { Search, Clock, AlertCircle, CheckCircle, Loader2, Eye, Copy, Check } from 'lucide-react';

const SupplierCompliancePortalList: React.FC = () => {
  const navigate = useNavigate();
  const [supplierId, setSupplierId] = useState('');
  const [requests, setRequests] = useState<ComplianceRequest[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const loadRequests = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!supplierId.trim()) {
      setError('Please enter your Supplier ID');
      return;
    }

    setError('');
    setLoading(true);
    setSearched(true);

    try {
      // Fetch compliance requests for this supplier
      const reqs = await getComplianceRequestsBySupplierId(supplierId.trim());

      // Fetch categories for mapping
      const cats = await getCategories();
      const catMap: Record<string, string> = {};
      cats.forEach(cat => {
        catMap[cat.id] = cat.name;
      });

      setCategories(catMap);

      // Filter to show only pending requests (not yet submitted)
      const pendingReqs = reqs.filter(r => r.status === ComplianceRequestStatus.PENDING_SUPPLIER);
      setRequests(pendingReqs);

      if (pendingReqs.length === 0 && reqs.length > 0) {
        setError('You have no pending TCF requests. All requests have been submitted or completed.');
      } else if (pendingReqs.length === 0) {
        setError('No TCF requests found for this Supplier ID.');
      }
    } catch (err: any) {
      console.error('Failed to load requests:', err);
      setError('Failed to load requests. Please check your Supplier ID and try again.');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPortal = (req: ComplianceRequest) => {
    navigate(`/compliance/supplier/${req.token}`);
  };

  const copyAccessCode = (code: string | undefined, e: React.MouseEvent) => {
    e.stopPropagation();
    if (code) {
      navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    }
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return 'No deadline';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getDaysUntilDeadline = (dateStr: string | undefined) => {
    if (!dateStr) return null;
    const deadline = new Date(dateStr);
    const today = new Date();
    const diffTime = deadline.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getDeadlineColor = (days: number | null) => {
    if (days === null) return 'text-gray-600';
    if (days < 0) return 'text-red-600';
    if (days <= 7) return 'text-orange-600';
    return 'text-green-600';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Technical Compliance Framework</h1>
          <p className="text-lg text-gray-600">Supplier Portal - View and Complete Compliance Requests</p>
        </div>

        {/* Search Card */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <form onSubmit={loadRequests} className="space-y-4">
            <div>
              <label htmlFor="supplierId" className="block text-sm font-medium text-gray-700 mb-2">
                Enter Your Supplier ID
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-3 text-gray-400 w-5 h-5" />
                <input
                  id="supplierId"
                  type="text"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  placeholder="e.g., SUP-001 or your company code"
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  disabled={loading}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                You can find your Supplier ID in your company information or contact your account manager
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !supplierId.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Find My TCF Requests
                </>
              )}
            </button>
          </form>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8 flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* Requests List */}
        {searched && requests.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Your Pending TCF Requests</h2>
            {requests.map((req) => {
              const daysLeft = getDaysUntilDeadline(req.deadline);
              return (
                <div
                  key={req.id}
                  onClick={() => handleOpenPortal(req)}
                  className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer border-l-4 border-blue-500"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Project Name */}
                      <h3 className="text-lg font-semibold text-gray-900 mb-1 truncate">
                        {req.projectName}
                      </h3>

                      {/* Request ID and Category */}
                      <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-3">
                        <span className="font-medium">
                          Request: <span className="text-gray-900">{req.requestId}</span>
                        </span>
                        {req.categoryId && (
                          <span>
                            Category: <span className="text-gray-900 font-medium">{categories[req.categoryId] || req.categoryId}</span>
                          </span>
                        )}
                      </div>

                      {/* Deadline */}
                      {req.deadline && (
                        <div className={`flex items-center gap-2 text-sm ${getDeadlineColor(daysLeft)}`}>
                          <Clock className="w-4 h-4" />
                          <span>
                            Due: {formatDate(req.deadline)}
                            {daysLeft !== null && (
                              <span className="ml-2 font-semibold">
                                ({daysLeft < 0 ? `${Math.abs(daysLeft)} days overdue` : `${daysLeft} days left`})
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Access Code and Action */}
                    <div className="flex flex-col items-end gap-3">
                      {/* Access Code Card */}
                      <div className="bg-gray-50 rounded-lg px-4 py-3 border border-gray-200">
                        <p className="text-xs text-gray-600 mb-1 font-medium">Access Code</p>
                        <div className="flex items-center gap-2">
                          <code className="text-lg font-bold text-blue-600 tracking-wider">
                            {req.accessCode || '---'}
                          </code>
                          {req.accessCode && (
                            <button
                              onClick={(e) => copyAccessCode(req.accessCode, e)}
                              className="p-1.5 hover:bg-gray-200 rounded transition-colors"
                              title="Copy access code"
                            >
                              {copiedCode === req.accessCode ? (
                                <Check className="w-4 h-4 text-green-600" />
                              ) : (
                                <Copy className="w-4 h-4 text-gray-500" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Open Button */}
                      <button
                        onClick={() => handleOpenPortal(req)}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap"
                      >
                        <Eye className="w-4 h-4" />
                        Open Request
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {searched && requests.length === 0 && !error && (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4 opacity-50" />
            <p className="text-gray-600 text-lg">No pending TCF requests found.</p>
          </div>
        )}

        {/* Footer Info */}
        <div className="mt-8 bg-blue-50 rounded-lg p-6 border border-blue-200">
          <h4 className="font-semibold text-gray-900 mb-2">How to complete your TCF request:</h4>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
            <li>Find your Supplier ID in your company information</li>
            <li>Enter it above to see your pending requests</li>
            <li>Click "Open Request" for the TCF you need to complete</li>
            <li>Have your 6-digit access code ready (shown above)</li>
            <li>Answer all compliance questions and submit</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default SupplierCompliancePortalList;
