// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import AiMarkdownMessage from './AiMarkdownMessage';

describe('AiMarkdownMessage', () => {
  it('renders a markdown table as an HTML table with headers and rows', () => {
    const content = [
      '| Merchant | Count |',
      '| --- | --- |',
      '| Netflix | 12 |',
      '| Spotify | 8 |',
    ].join('\n');

    render(<AiMarkdownMessage content={content} />);

    const table = screen.getByRole('table');
    expect(within(table).getByText('Merchant')).toBeInTheDocument();
    expect(within(table).getByText('Count')).toBeInTheDocument();

    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('Netflix')).toBeInTheDocument();
    expect(within(rows[1]).getByText('12')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Spotify')).toBeInTheDocument();
  });

  it('renders bold text, lists, and inline code', () => {
    const content = [
      '**Summary**',
      '',
      '- First item',
      '- Second item with `inline code`',
    ].join('\n');

    render(<AiMarkdownMessage content={content} />);

    expect(screen.getByText('Summary').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('inline code').tagName).toBe('CODE');
  });

  it('renders links with target blank and rel noopener', () => {
    render(<AiMarkdownMessage content="[docs](https://example.com/docs)" />);

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('preserves single newlines as line breaks within a paragraph', () => {
    const { container } = render(<AiMarkdownMessage content={'Line one\nLine two'} />);

    expect(container.querySelector('br')).not.toBeNull();
  });
});
