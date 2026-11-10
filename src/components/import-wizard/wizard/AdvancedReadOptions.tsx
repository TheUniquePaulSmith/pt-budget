'use client';

/**
 * Advanced, for a delimited file that was read wrongly: which line holds the
 * column names, what separates the cells, which encoding the file is in. The
 * file is read again with these choices; a saved format remembers them.
 */

import React, { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import type { ImportIssue, ReadOptions } from '@/lib/statementImport';

import { useIssueTexts } from './issueText';
import type { ReadOptionsOutcome } from './useImportWizard';
import type { StatementSession } from './wizardModel';

const AUTO = 'auto';
const DELIMITERS = [',', ';', '\t', '|'] as const;
const DELIMITER_KEYS: Record<string, 'comma' | 'semicolon' | 'tab' | 'pipe'> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
};
const ENCODINGS = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252'] as const;

interface AdvancedReadOptionsProps {
  statement: StatementSession;
  onApply: (options: ReadOptions) => Promise<ReadOptionsOutcome>;
}

export default function AdvancedReadOptions({ statement, onApply }: AdvancedReadOptionsProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const texts = useIssueTexts();
  const { meta } = statement.table;
  const { readOptions } = statement;

  const [headerLine, setHeaderLine] = useState('');
  const [noHeader, setNoHeader] = useState(false);
  const [delimiter, setDelimiter] = useState<string>(AUTO);
  const [encoding, setEncoding] = useState<string>(AUTO);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<ImportIssue[] | null>(null);

  // The form shows the choices in effect; a value that was detected, not chosen, shows as "automatic".
  useEffect(() => {
    setNoHeader(readOptions.headerLine === null);
    setHeaderLine(typeof readOptions.headerLine === 'number' ? String(readOptions.headerLine) : '');
    setDelimiter(readOptions.delimiter ?? AUTO);
    setEncoding(readOptions.encoding ?? AUTO);
    setFailure(null);
  }, [readOptions]);

  const apply = async () => {
    const options: ReadOptions = {};
    const line = Number(headerLine);
    if (noHeader) options.headerLine = null;
    else if (headerLine.trim() !== '' && Number.isInteger(line) && line >= 1) options.headerLine = line;
    if (delimiter !== AUTO) options.delimiter = delimiter;
    if (encoding !== AUTO) options.encoding = encoding;
    setApplying(true);
    setFailure(null);
    try {
      const outcome = await onApply(options);
      if (!outcome.ok) setFailure(outcome.issues);
    } finally {
      setApplying(false);
    }
  };

  const detectedDelimiter = meta.delimiter ? DELIMITER_KEYS[meta.delimiter] : undefined;

  return (
    <Accordion variant="outlined" disableGutters data-testid="import-advanced">
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box>
          <Typography variant="subtitle1">{t('advanced.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('advanced.subtitle')}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
          <Box>
            <TextField
              fullWidth
              size="small"
              type="number"
              label={t('advanced.headerLine')}
              value={headerLine}
              disabled={noHeader}
              onChange={(event) => setHeaderLine(event.target.value)}
              helperText={
                meta.headerLine == null ? t('advanced.headerNone') : t('advanced.headerDetected', { line: meta.headerLine })
              }
              slotProps={{ htmlInput: { min: 1, 'data-testid': 'import-advanced-header-line' } }}
            />
            <FormControlLabel
              control={<Checkbox size="small" checked={noHeader} onChange={(event) => setNoHeader(event.target.checked)} />}
              label={t('advanced.noHeader')}
            />
          </Box>
          <FormControl fullWidth size="small">
            <InputLabel id="import-advanced-delimiter-label">{t('advanced.delimiter')}</InputLabel>
            <Select
              labelId="import-advanced-delimiter-label"
              label={t('advanced.delimiter')}
              value={delimiter}
              onChange={(event) => setDelimiter(event.target.value)}
              SelectDisplayProps={{ 'data-testid': 'import-advanced-delimiter' } as React.HTMLAttributes<HTMLDivElement>}
            >
              <MenuItem value={AUTO}>
                {detectedDelimiter
                  ? t('advanced.automaticWith', { value: t(`advanced.delimiters.${detectedDelimiter}`) })
                  : t('advanced.automatic')}
              </MenuItem>
              {DELIMITERS.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`advanced.delimiters.${DELIMITER_KEYS[value]}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel id="import-advanced-encoding-label">{t('advanced.encoding')}</InputLabel>
            <Select
              labelId="import-advanced-encoding-label"
              label={t('advanced.encoding')}
              value={encoding}
              onChange={(event) => setEncoding(event.target.value)}
              SelectDisplayProps={{ 'data-testid': 'import-advanced-encoding' } as React.HTMLAttributes<HTMLDivElement>}
            >
              <MenuItem value={AUTO}>{t('advanced.automaticWith', { value: meta.encoding.toUpperCase() })}</MenuItem>
              {ENCODINGS.map((value) => (
                <MenuItem key={value} value={value}>
                  {value.toUpperCase()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {failure && (
          <Alert severity="error" sx={{ mt: 2 }} data-testid="import-advanced-failure">
            {failure.length > 0 ? failure.map((issue) => texts.title(issue)).join(' · ') : t('advanced.failed')}
          </Alert>
        )}
        <Button variant="outlined" onClick={() => void apply()} disabled={applying} sx={{ mt: 2 }} data-testid="import-advanced-apply">
          {applying ? t('advanced.applying') : t('advanced.apply')}
        </Button>
      </AccordionDetails>
    </Accordion>
  );
}
