/**
 * Skeleton loader components
 * Placeholder components while data is loading
 */

import React from 'react';

interface SkeletonProps {
  height?: number | string;
  width?: number | string;
  radius?: number;
  className?: string;
  count?: number;
}

/**
 * Generic skeleton placeholder
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  height = 20,
  width = '100%',
  radius = 4,
  className = '',
  count = 1
}) => {
  const items = Array.from({ length: count });

  const heightStyle = typeof height === 'number' ? `${height}px` : height;
  const widthStyle = typeof width === 'number' ? `${width}px` : width;

  return (
    <>
      {items.map((_, i) => (
        <div
          key={i}
          className={`animate-pulse bg-gray-200 ${className}`}
          style={{
            height: heightStyle,
            width: widthStyle,
            borderRadius: `${radius}px`
          }}
        />
      ))}
    </>
  );
};

/**
 * Skeleton for text content
 */
export const TextSkeleton: React.FC<SkeletonProps> = (props) => {
  return <Skeleton height={props.height || 20} width={props.width} {...props} />;
};

/**
 * Skeleton for avatar images
 */
interface AvatarSkeletonProps {
  size?: number;
}

export const AvatarSkeleton: React.FC<AvatarSkeletonProps> = ({ size = 40 }) => {
  return (
    <div
      className="animate-pulse bg-gray-200 rounded-full"
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
};

/**
 * Skeleton for card layout
 */
interface CardSkeletonProps {
  lines?: number;
}

export const CardSkeleton: React.FC<CardSkeletonProps> = ({ lines = 3 }) => {
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <AvatarSkeleton size={40} />
        <div className="flex-1 space-y-2">
          <Skeleton height={16} width="60%" />
          <Skeleton height={12} width="40%" />
        </div>
      </div>

      {/* Content */}
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            height={12}
            width={i === lines - 1 ? '80%' : '100%'}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="flex gap-2 mt-4">
        <Skeleton height={32} width="48%" radius={4} />
        <Skeleton height={32} width="48%" radius={4} />
      </div>
    </div>
  );
};

/**
 * Skeleton for table rows
 */
interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export const TableSkeleton: React.FC<TableSkeletonProps> = ({ rows = 5, columns = 4 }) => {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} height={20} width={`${100 / columns}%`} />
          ))}
        </div>
      ))}
    </div>
  );
};

/**
 * Skeleton for image
 */
interface ImageSkeletonProps {
  width?: string;
  height?: string;
  aspectRatio?: string;
}

export const ImageSkeleton: React.FC<ImageSkeletonProps> = ({
  width = '100%',
  height = '200px',
  aspectRatio = '16/9'
}) => {
  return (
    <div
      className="animate-pulse bg-gray-200 rounded-lg"
      style={{
        width,
        height,
        aspectRatio
      }}
    />
  );
};

/**
 * Skeleton for button
 */
export const ButtonSkeleton: React.FC<{ width?: string }> = ({ width = '120px' }) => {
  return <Skeleton height={40} width={width} radius={6} />;
};

/**
 * Skeleton for list items
 */
interface ListSkeletonProps {
  count?: number;
  lineCount?: number;
}

export const ListSkeleton: React.FC<ListSkeletonProps> = ({ count = 5, lineCount = 2 }) => {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <AvatarSkeleton size={32} />
          <div className="flex-1 space-y-2">
            {Array.from({ length: lineCount }).map((_, j) => (
              <Skeleton
                key={j}
                height={12}
                width={j === 0 ? '70%' : '100%'}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
