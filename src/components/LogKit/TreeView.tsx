import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Code, Activity, Database } from 'lucide-react';
import { formatDuration } from '../../utils/apexLogParser';
import type { MethodNode } from '../../utils/apexLogParser';

interface TreeViewProps {
  nodes: MethodNode[];
}

interface TreeNodeProps {
  node: MethodNode;
  isRoot?: boolean;
}

const TreeNodeComponent: React.FC<TreeNodeProps> = ({ node, isRoot = false }) => {
  const [isExpanded, setIsExpanded] = useState(isRoot);

  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'METHOD': return <Code size={14} className="text-blue-400" />;
      case 'CODE_UNIT': return <Activity size={14} className="text-purple-400" />;
      case 'SOQL': return <Database size={14} className="text-green-400" />;
      case 'DML': return <Database size={14} className="text-orange-400" />;
      default: return <Code size={14} className="text-gray-400" />;
    }
  };

  const getNodeColor = (type: string) => {
    switch (type) {
      case 'METHOD': return 'border-blue-500/30 hover:bg-blue-500/5';
      case 'CODE_UNIT': return 'border-purple-500/30 hover:bg-purple-500/5';
      case 'SOQL': return 'border-green-500/30 hover:bg-green-500/5';
      case 'DML': return 'border-orange-500/30 hover:bg-orange-500/5';
      default: return 'border-gray-500/30 hover:bg-gray-500/5';
    }
  };

  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="text-zinc-300">
      {/* Node Header */}
      <div
        className={`flex items-center space-x-2 py-2 px-3 rounded border ${getNodeColor(node.type)} transition-colors cursor-pointer`}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {/* Expand/Collapse Icon */}
        <div className="w-4 flex items-center justify-center">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown size={14} className="text-zinc-400" />
            ) : (
              <ChevronRight size={14} className="text-zinc-400" />
            )
          ) : (
            <div className="w-1 h-1 rounded-full bg-zinc-600" />
          )}
        </div>

        {/* Node Icon */}
        {getNodeIcon(node.type)}

        {/* Node Name */}
        <div className="flex-1 flex items-center justify-between">
          <span className="text-[11px] font-mono text-zinc-200 truncate">
            {node.name}
          </span>
          
          {/* Duration Badge */}
          {node.duration !== undefined && (
            <span className="text-[9px] px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 ml-2">
              {formatDuration(node.duration)}
            </span>
          )}
        </div>

        {/* Children Count */}
        {hasChildren && (
          <span className="text-[9px] px-1.5 py-0.5 bg-zinc-700 rounded text-zinc-400">
            {node.children.length}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="ml-6 mt-1 space-y-1 border-l-2 border-zinc-800 pl-2">
          {node.children.map((child, index) => (
            <TreeNodeComponent key={child.id || index} node={child} />
          ))}
        </div>
      )}
    </div>
  );
};

const TreeView: React.FC<TreeViewProps> = ({ nodes }) => {
  if (nodes.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500">
        <Activity className="mx-auto mb-2" size={32} />
        <p>No method calls found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Tree Header */}
      <div className="flex items-center justify-between text-[9px] text-zinc-400 uppercase tracking-wider mb-4">
        <span>Call Hierarchy ({nodes.length} root nodes)</span>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span>Method</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 rounded-full bg-purple-500" />
            <span>Code Unit</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span>SOQL</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 rounded-full bg-orange-500" />
            <span>DML</span>
          </div>
        </div>
      </div>

      {/* Tree Nodes */}
      <div className="space-y-2">
        {nodes.map((node, index) => (
          <TreeNodeComponent key={node.id || index} node={node} isRoot />
        ))}
      </div>
    </div>
  );
};

export default TreeView;
