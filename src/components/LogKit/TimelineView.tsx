import React, { useMemo } from 'react';
import { Clock, Database, Code, Activity } from 'lucide-react';
import { formatDuration } from '../../utils/apexLogParser';
import type { TimelineEvent } from '../../utils/apexLogParser';

interface TimelineViewProps {
  events: TimelineEvent[];
}

const TimelineView: React.FC<TimelineViewProps> = ({ events }) => {
  const { sortedEvents, maxTime, minTime } = useMemo(() => {
    if (events.length === 0) {
      return { sortedEvents: [], maxTime: 0, minTime: 0 };
    }

    const sorted = [...events].sort((a, b) => a.startTime - b.startTime);
    const min = sorted[0].startTime;
    const max = Math.max(...sorted.map(e => e.endTime));
    
    return { sortedEvents: sorted, maxTime: max, minTime: min };
  }, [events]);

  const getEventColor = (type: string) => {
    switch (type) {
      case 'METHOD': return 'bg-blue-500';
      case 'CODE_UNIT': return 'bg-purple-500';
      case 'SOQL': return 'bg-green-500';
      case 'DML': return 'bg-orange-500';
      default: return 'bg-gray-500';
    }
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'METHOD': return <Code size={12} />;
      case 'CODE_UNIT': return <Activity size={12} />;
      case 'SOQL': return <Database size={12} />;
      case 'DML': return <Database size={12} />;
      default: return <Clock size={12} />;
    }
  };

  const calculatePosition = (time: number) => {
    if (maxTime === minTime) return 0;
    return ((time - minTime) / (maxTime - minTime)) * 100;
  };

  const calculateWidth = (start: number, end: number) => {
    if (maxTime === minTime) return 100;
    return ((end - start) / (maxTime - minTime)) * 100;
  };

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500">
        <Clock className="mx-auto mb-2" size={32} />
        <p>No timeline events found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Timeline Header */}
      <div className="flex items-center justify-between text-[9px] text-zinc-400 uppercase tracking-wider">
        <span>Event Timeline ({events.length} events)</span>
        <span>Total: {formatDuration(maxTime - minTime)}</span>
      </div>

      {/* Timeline Events */}
      <div className="space-y-2">
        {sortedEvents.map((event, index) => {
          const leftPos = calculatePosition(event.startTime);
          const width = calculateWidth(event.startTime, event.endTime);

          return (
            <div 
              key={event.id || index}
              className="group relative"
              style={{ paddingLeft: `${event.depth * 20}px` }}
            >
              {/* Event Bar */}
              <div className="relative h-8 bg-zinc-800 rounded border border-zinc-700 overflow-hidden">
                <div
                  className={`absolute top-0 bottom-0 ${getEventColor(event.type)} opacity-80 group-hover:opacity-100 transition-opacity flex items-center px-2`}
                  style={{
                    left: `${leftPos}%`,
                    width: `${Math.max(width, 2)}%`
                  }}
                >
                  <span className="text-white text-[10px] font-bold truncate flex items-center space-x-1">
                    {getEventIcon(event.type)}
                    <span>{event.name}</span>
                  </span>
                </div>
              </div>

              {/* Event Details */}
              <div className="absolute left-0 top-full mt-1 hidden group-hover:block bg-zinc-900 border border-zinc-700 rounded p-2 text-[9px] z-10 min-w-[200px]">
                <div className="space-y-1">
                  <p className="text-white font-bold">{event.name}</p>
                  <p className="text-zinc-400">Type: {event.type}</p>
                  <p className="text-zinc-400">Duration: {formatDuration(event.duration)}</p>
                  {event.details && <p className="text-zinc-400">{event.details}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TimelineView;
