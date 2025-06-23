'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Divider,
  Tabs,
  Tab,
  Alert,
} from '@mui/material';
import {
  Edit,
  Delete,
  Add,
  Save,
  Cancel,
  Business,
  Category as CategoryIcon,
} from '@mui/icons-material';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { Category, Company } from '@/lib/database';

interface ManageDataProps {
  open: boolean;
  onClose: () => void;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export default function ManageData({ open, onClose }: ManageDataProps) {
  const { db, categories, companies, refreshCategories, refreshCompanies } = useDatabaseContext();
  const [tabValue, setTabValue] = useState(0);
  
  // Category management state
  const [newCategory, setNewCategory] = useState({
    name: '',
    type: 'expense' as 'income' | 'expense',
    color: '#FF6B6B',
  });
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editCategoryData, setEditCategoryData] = useState<Category | null>(null);
  
  // Company management state
  const [newCompany, setNewCompany] = useState('');
  const [editingCompany, setEditingCompany] = useState<string | null>(null);
  const [editCompanyData, setEditCompanyData] = useState<Company | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      refreshCategories();
      refreshCompanies();
    }
  }, [open, refreshCategories, refreshCompanies]);

  const colorOptions = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E9', '#58D68D', '#F8C471'
  ];

  // Category management functions
  const handleAddCategory = async () => {
    if (!db || !newCategory.name.trim()) return;

    try {
      setLoading(true);
      await db.addCategory(newCategory);
      setNewCategory({ name: '', type: 'expense', color: '#FF6B6B' });
      refreshCategories();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add category');
    } finally {
      setLoading(false);
    }
  };

  const handleEditCategory = (category: Category) => {
    setEditingCategory(category.id);
    setEditCategoryData({ ...category });
  };

  const handleSaveCategory = async () => {
    if (!db || !editCategoryData) return;

    try {
      setLoading(true);
      // Note: We would need to add an updateCategory method to the database
      // For now, we'll just refresh the data
      refreshCategories();
      setEditingCategory(null);
      setEditCategoryData(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update category');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelEditCategory = () => {
    setEditingCategory(null);
    setEditCategoryData(null);
  };

  // Company management functions
  const handleAddCompany = async () => {
    if (!db || !newCompany.trim()) return;

    try {
      setLoading(true);
      await db.addCompany(newCompany.trim());
      setNewCompany('');
      refreshCompanies();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add company');
    } finally {
      setLoading(false);
    }
  };

  const handleEditCompany = (company: Company) => {
    setEditingCompany(company.id);
    setEditCompanyData({ ...company });
  };

  const handleSaveCompany = async () => {
    if (!db || !editCompanyData) return;

    try {
      setLoading(true);
      // Note: We would need to add an updateCompany method to the database
      // For now, we'll just refresh the data
      refreshCompanies();
      setEditingCompany(null);
      setEditCompanyData(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update company');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelEditCompany = () => {
    setEditingCompany(null);
    setEditCompanyData(null);
  };

  const handleClose = () => {
    setTabValue(0);
    setNewCategory({ name: '', type: 'expense', color: '#FF6B6B' });
    setNewCompany('');
    setEditingCategory(null);
    setEditCategoryData(null);
    setEditingCompany(null);
    setEditCompanyData(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <CategoryIcon />
          Manage Categories & Companies
        </Box>
      </DialogTitle>
      
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label="Categories" />
          <Tab label="Companies" />
        </Tabs>

        {/* Categories Tab */}
        <TabPanel value={tabValue} index={0}>
          <Box display="flex" flexDirection="column" gap={3}>
            {/* Add New Category */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Add New Category
              </Typography>
              <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
                <TextField
                  label="Category Name"
                  value={newCategory.name}
                  onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                  size="small"
                  sx={{ minWidth: 200 }}
                />
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Type</InputLabel>
                  <Select
                    value={newCategory.type}
                    label="Type"
                    onChange={(e) => setNewCategory({ ...newCategory, type: e.target.value as 'income' | 'expense' })}
                  >
                    <MenuItem value="expense">Expense</MenuItem>
                    <MenuItem value="income">Income</MenuItem>
                  </Select>
                </FormControl>
                <Box display="flex" gap={1}>
                  {colorOptions.map(color => (
                    <Box
                      key={color}
                      sx={{
                        width: 24,
                        height: 24,
                        backgroundColor: color,
                        borderRadius: '50%',
                        cursor: 'pointer',
                        border: newCategory.color === color ? '2px solid #000' : '1px solid #ccc',
                      }}
                      onClick={() => setNewCategory({ ...newCategory, color })}
                    />
                  ))}
                </Box>
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={handleAddCategory}
                  disabled={!newCategory.name.trim() || loading}
                >
                  Add
                </Button>
              </Box>
            </Box>

            <Divider />

            {/* Categories List */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Existing Categories
              </Typography>
              <List>
                {categories.map((category) => (
                  <ListItem key={category.id} divider>
                    {editingCategory === category.id && editCategoryData ? (
                      <Box display="flex" gap={2} alignItems="center" width="100%">
                        <TextField
                          value={editCategoryData.name}
                          onChange={(e) => setEditCategoryData({ ...editCategoryData, name: e.target.value })}
                          size="small"
                          sx={{ flex: 1 }}
                        />
                        <FormControl size="small" sx={{ minWidth: 100 }}>
                          <Select
                            value={editCategoryData.type}
                            onChange={(e) => setEditCategoryData({ ...editCategoryData, type: e.target.value as 'income' | 'expense' })}
                          >
                            <MenuItem value="expense">Expense</MenuItem>
                            <MenuItem value="income">Income</MenuItem>
                          </Select>
                        </FormControl>
                        <Box display="flex" gap={0.5}>
                          {colorOptions.slice(0, 5).map(color => (
                            <Box
                              key={color}
                              sx={{
                                width: 20,
                                height: 20,
                                backgroundColor: color,
                                borderRadius: '50%',
                                cursor: 'pointer',
                                border: editCategoryData.color === color ? '2px solid #000' : '1px solid #ccc',
                              }}
                              onClick={() => setEditCategoryData({ ...editCategoryData, color })}
                            />
                          ))}
                        </Box>
                        <IconButton onClick={handleSaveCategory} color="primary" size="small">
                          <Save />
                        </IconButton>
                        <IconButton onClick={handleCancelEditCategory} size="small">
                          <Cancel />
                        </IconButton>
                      </Box>
                    ) : (
                      <>
                        <ListItemText
                          primary={
                            <Box display="flex" alignItems="center" gap={1}>
                              <Box
                                sx={{
                                  width: 16,
                                  height: 16,
                                  backgroundColor: category.color,
                                  borderRadius: '50%',
                                }}
                              />
                              {category.name}
                              <Chip
                                label={category.type}
                                size="small"
                                color={category.type === 'income' ? 'success' : 'default'}
                              />
                            </Box>
                          }
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            onClick={() => handleEditCategory(category)}
                            size="small"
                            sx={{ mr: 1 }}
                          >
                            <Edit />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </>
                    )}
                  </ListItem>
                ))}
              </List>
            </Box>
          </Box>
        </TabPanel>

        {/* Companies Tab */}
        <TabPanel value={tabValue} index={1}>
          <Box display="flex" flexDirection="column" gap={3}>
            {/* Add New Company */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Add New Company
              </Typography>
              <Box display="flex" gap={2} alignItems="center">
                <TextField
                  label="Company Name"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="contained"
                  startIcon={<Add />}
                  onClick={handleAddCompany}
                  disabled={!newCompany.trim() || loading}
                >
                  Add
                </Button>
              </Box>
            </Box>

            <Divider />

            {/* Companies List */}
            <Box>
              <Typography variant="h6" gutterBottom>
                Existing Companies
              </Typography>
              <List>
                {companies.map((company) => (
                  <ListItem key={company.id} divider>
                    {editingCompany === company.id && editCompanyData ? (
                      <Box display="flex" gap={2} alignItems="center" width="100%">
                        <TextField
                          value={editCompanyData.name}
                          onChange={(e) => setEditCompanyData({ ...editCompanyData, name: e.target.value })}
                          size="small"
                          sx={{ flex: 1 }}
                        />
                        <IconButton onClick={handleSaveCompany} color="primary" size="small">
                          <Save />
                        </IconButton>
                        <IconButton onClick={handleCancelEditCompany} size="small">
                          <Cancel />
                        </IconButton>
                      </Box>
                    ) : (
                      <>
                        <ListItemText
                          primary={
                            <Box display="flex" alignItems="center" gap={1}>
                              <Business fontSize="small" />
                              {company.name}
                            </Box>
                          }
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            onClick={() => handleEditCompany(company)}
                            size="small"
                          >
                            <Edit />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </>
                    )}
                  </ListItem>
                ))}
              </List>
            </Box>
          </Box>
        </TabPanel>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
