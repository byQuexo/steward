import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // Headings inside an answer must not compete with the page outline.
  h1: ({ node: _node, ...props }) => <h3 {...props} />,
  h2: ({ node: _node, ...props }) => <h4 {...props} />,
  h3: ({ node: _node, ...props }) => <h5 {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto" tabIndex={0}>
      <table {...props} />
    </div>
  ),
};

/** Assistant answers are Markdown (GFM). Raw HTML is not rendered. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ?? 'prose-answer'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
