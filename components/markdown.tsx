import Link from 'next/link';
import React, { memo } from 'react';
import { Streamdown, type StreamdownProps } from 'streamdown';

type Components = StreamdownProps['components'];

// Function to sanitize text and escape LaTeX delimiters
const sanitizeForMarkdown = (text: string): string => {
  if (!text || typeof text !== 'string') return text;

  return (
    text
      // Escape single dollar signs that might trigger LaTeX math mode
      .replace(/(?<!\$)\$(?!\$)/g, '\\$')
      // Escape double dollar signs
      .replace(/\$\$/g, '\\$\\$')
      // Escape backslashes that might be part of LaTeX commands
      .replace(/\\/g, '\\\\')
  );
};

const components: Partial<Components> = {
  a: ({ node, children, ...props }) => {
    return (
      // @ts-expect-error
      <Link
        className="text-blue-500 hover:underline"
        target="_blank"
        rel="noreferrer"
        {...props}
      >
        {children}
      </Link>
    );
  },
  table: ({ node, children, ...props }) => {
    return (
      <div className="table-container w-full max-w-full overflow-x-auto mb-4 scrollbar-thin">
        <table
          className="min-w-full border-collapse border border-border text-sm box-border"
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },
  thead: ({ node, children, ...props }) => (
    <thead className="bg-muted/50" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ node, children, ...props }) => (
    <tbody className="divide-y divide-border" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ node, children, ...props }) => (
    <tr className="hover:bg-muted/30" {...props}>
      {children}
    </tr>
  ),
  th: ({ node, children, ...props }) => (
    <th
      className="border border-border px-3 py-2 text-left font-semibold break-words"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ node, children, ...props }) => (
    <td className="border border-border px-3 py-2 break-words" {...props}>
      {children}
    </td>
  ),
};

const NonMemoizedMarkdown = ({ children }: { children: string }) => (
  <Streamdown components={components}>
    {sanitizeForMarkdown(children)}
  </Streamdown>
);

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);
