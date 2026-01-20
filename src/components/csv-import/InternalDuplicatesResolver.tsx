'use client';

import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
} from '@mui/material';
import { CheckCircle, Cancel } from '@mui/icons-material';
import { Transaction } from '@/types/database';
import { format, parseISO } from 'date-fns';

interface DuplicateGroup {
  hash: string;
  transactions: Array<{
    index: number;
    transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;
    csvAccountValue: string;
    tempId: number;
  }>;
}

interface InternalDuplicatesResolverProps {
  open: boolean;
  onClose: () => void;
  duplicateGroups: DuplicateGroup[];
  onResolve: (selectedIndices: Set<number>) => void;
}

export default function InternalDuplicatesResolver({
  open,
  onClose,
  duplicateGroups,
  onResolve,
}: InternalDuplicatesResolverProps) {
  // Track which transaction indices should be included (by default, keep first of each group)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    duplicateGroups.forEach(group => {
      if (group.transactions.length > 0) {
        initial.add(group.transactions[0].index);
      }
    });
    return initial;
  });

  const toggleSelection = (index: number) => {
    setSelectedIndices(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const handleOk = () => {
    onResolve(selectedIndices);
  };

  const handleCancel = () => {
    onClose();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const totalDuplicates = useMemo(() => {
    return duplicateGroups.reduce((sum, group) => sum + group.transactions.length, 0);
  }, [duplicateGroups]);

  const selectedCount = selectedIndices.size;
  const excludedCount = totalDuplicates - selectedCount;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Box>
          <Typography variant="h6" component="div">
            Resolve Internal Duplicates
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Found {duplicateGroups.length} sets of duplicate transactions within your CSV. 
            Select which records to include in the import.
          </Typography>
          <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
            <Chip 
              label={`${selectedCount} Selected`} 
              color="success" 
              size="small"
            />
            <Chip 
              label={`${excludedCount} Excluded`} 
              color="error" 
              size="small"
            />
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box>
          <Alert severity="info" sx={{ mb: 3 }}>
            <Typography variant="body2">
              <strong>How duplicate resolution works:</strong> When you select multiple transactions from the same set, 
              each will receive a unique variation seed. The first selected transaction keeps the original hash (seed 0), 
              while subsequent selections get incrementing seeds (1, 2, etc.). This allows you to import legitimate duplicates 
              while preventing re-imports of the same CSV file.
            </Typography>
          </Alert>
          
          {duplicateGroups.map((group, groupIndex) => (
            <Box key={group.hash} sx={{ mb: 4 }}>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Duplicate Set {groupIndex + 1} ({group.transactions.length} records)
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'action.hover' }}>
                      <TableCell width="80px" align="center">Include</TableCell>
                      <TableCell width="100px" align="center">Variation</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Description</TableCell>
                      <TableCell>Account</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell>Type</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {group.transactions.map((item, idx) => {
                      const isSelected = selectedIndices.has(item.index);
                      // Calculate what variation seed this transaction would get
                      const selectedBeforeThis = group.transactions
                        .slice(0, idx + 1)
                        .filter((t, i) => i <= idx && selectedIndices.has(t.index))
                        .length - 1;
                      const variationSeed = isSelected ? selectedBeforeThis : null;
                      
                      return (
                        <TableRow 
                          key={item.index}
                          sx={{ 
                            bgcolor: isSelected ? 'success.lighter' : 'error.lighter',
                            opacity: isSelected ? 1 : 0.6,
                          }}
                        >
                          <TableCell align="center">
                            <IconButton
                              size="small"
                              onClick={() => toggleSelection(item.index)}
                              color={isSelected ? 'success' : 'error'}
                            >
                              {isSelected ? <CheckCircle /> : <Cancel />}
                            </IconButton>
                          </TableCell>
                          <TableCell align="center">
                            {isSelected && variationSeed !== null ? (
                              <Chip
                                label={variationSeed === 0 ? 'Original' : `Seed ${variationSeed}`}
                                size="small"
                                color={variationSeed === 0 ? 'default' : 'primary'}
                                variant="outlined"
                              />
                            ) : (
                              <Typography variant="body2" color="text.disabled">
                                -
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            {format(parseISO(item.transaction.date), 'MMM dd, yyyy')}
                          </TableCell>
                          <TableCell>{item.transaction.description}</TableCell>
                          <TableCell>
                            <Typography variant="body2" noWrap>
                              {item.csvAccountValue}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography
                              variant="body2"
                              color={item.transaction.type === 'income' ? 'success.main' : 'error.main'}
                              fontWeight="medium"
                            >
                              {formatCurrency(item.transaction.amount)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={item.transaction.type}
                              size="small"
                              color={item.transaction.type === 'income' ? 'success' : 'error'}
                              variant="outlined"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>
          Cancel
        </Button>
        <Button onClick={handleOk} variant="contained" color="primary">
          Continue with {selectedCount} Transaction{selectedCount !== 1 ? 's' : ''}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
