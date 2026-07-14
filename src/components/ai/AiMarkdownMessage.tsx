'use client';

import React from 'react';
import {
  Box,
  Link,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

const markdownComponents: Components = {
  p: ({ children }) => (
    <Typography variant="body2" component="p" sx={{ mb: 1, '&:last-child': { mb: 0 } }}>
      {children}
    </Typography>
  ),
  h1: ({ children }) => <Typography variant="h6" sx={{ mt: 1, mb: 0.5 }}>{children}</Typography>,
  h2: ({ children }) => <Typography variant="subtitle1" sx={{ mt: 1, mb: 0.5 }}>{children}</Typography>,
  h3: ({ children }) => <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5 }}>{children}</Typography>,
  ul: ({ children }) => (
    <Box component="ul" sx={{ my: 0.5, pl: 3 }}>
      {children}
    </Box>
  ),
  ol: ({ children }) => (
    <Box component="ol" sx={{ my: 0.5, pl: 3 }}>
      {children}
    </Box>
  ),
  li: ({ children }) => (
    <Typography component="li" variant="body2" sx={{ mb: 0.25 }}>
      {children}
    </Typography>
  ),
  a: ({ children, href }) => (
    <Link href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  ),
  blockquote: ({ children }) => (
    <Box
      sx={{
        borderLeft: 3,
        borderColor: 'divider',
        pl: 1.5,
        ml: 0,
        my: 0.5,
        color: 'text.secondary',
      }}
    >
      {children}
    </Box>
  ),
  hr: () => <Box component="hr" sx={{ my: 1, border: 'none', borderTop: 1, borderColor: 'divider' }} />,
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className);
    if (!isBlock) {
      return (
        <Box
          component="code"
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.85em',
            bgcolor: 'action.hover',
            borderRadius: 0.5,
            px: 0.5,
            py: 0.1,
          }}
          {...props}
        >
          {children}
        </Box>
      );
    }

    return (
      <Box
        component="code"
        className={className}
        sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}
        {...props}
      >
        {children}
      </Box>
    );
  },
  pre: ({ children }) => (
    <Box
      component="pre"
      sx={{
        bgcolor: 'action.hover',
        borderRadius: 1,
        p: 1.25,
        my: 0.5,
        overflowX: 'auto',
        fontSize: '0.85em',
      }}
    >
      {children}
    </Box>
  ),
  table: ({ children }) => (
    <TableContainer sx={{ my: 1, border: 1, borderColor: 'divider', borderRadius: 1, minWidth: 0 }}>
      <Table size="small" sx={{ minWidth: 0 }}>{children}</Table>
    </TableContainer>
  ),
  thead: ({ children }) => <TableHead>{children}</TableHead>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children, style }) => (
    <TableCell
      sx={{ fontWeight: 600, wordBreak: 'break-word' }}
      align={style?.textAlign as 'left' | 'right' | 'center' | undefined}
    >
      {children}
    </TableCell>
  ),
  td: ({ children, style }) => (
    <TableCell
      sx={{ wordBreak: 'break-word' }}
      align={style?.textAlign as 'left' | 'right' | 'center' | undefined}
    >
      {children}
    </TableCell>
  ),
};

interface AiMarkdownMessageProps {
  content: string;
}

export default function AiMarkdownMessage({ content }: AiMarkdownMessageProps) {
  return (
    <Box sx={{ minWidth: 0, '& > *:first-of-type': { mt: 0 }, '& > *:last-child': { mb: 0 } }}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </Box>
  );
}
