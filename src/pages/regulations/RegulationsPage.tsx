/**
 * The Regulations section — the top-level home of the merged library (migration 139).
 *
 * A thin Layout wrapper around `RegulationLibraryContent`, which is also embedded
 * elsewhere without a Layout. Same split as the IM dashboard's tabs use.
 */

import React from 'react';
import { Scale } from 'lucide-react';

import Layout from '../../components/Layout';
import { RegulationLibraryContent } from './RegulationLibrary';

const RegulationsPage: React.FC = () => (
  <Layout>
    <div className="mb-5">
      <h1 className="text-xl font-bold text-primary flex items-center gap-2">
        <Scale size={20} /> Regulations
      </h1>
      <p className="text-sm text-gray-500 mt-1">
        The single library of regulations and standards. Each one carries its version, what it
        means for the technical file, what the manual must contain, and the summary the AI
        check reads.
      </p>
    </div>
    <RegulationLibraryContent />
  </Layout>
);

export default RegulationsPage;
