'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  Divider,
  Alert,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  Home as HomeIcon,
} from '@mui/icons-material';
import { useDatabaseContext } from '../contexts/DatabaseContext';
import { Project } from '../types/database';

const PROJECT_CATEGORIES = [
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'flooring', label: 'Flooring' },
  { value: 'painting', label: 'Painting' },
  { value: 'landscaping', label: 'Landscaping' },
  { value: 'general_contractor', label: 'General Contractor' },
  { value: 'other', label: 'Other' },
];

const PROJECT_STATUSES = [
  { value: 'planning', label: 'Planning', color: '#2196f3' },
  { value: 'in_progress', label: 'In Progress', color: '#ff9800' },
  { value: 'completed', label: 'Completed', color: '#4caf50' },
  { value: 'on_hold', label: 'On Hold', color: '#9e9e9e' },
];

interface ProjectFormData {
  name: string;
  company_name: string;
  contact_details: string;
  project_category: Project['project_category'];
  status: Project['status'];
  start_date: string;
  end_date: string;
  estimated_cost: string;
  actual_cost: string;
  notes: string;
}

const INITIAL_FORM_DATA: ProjectFormData = {
  name: '',
  company_name: '',
  contact_details: '',
  project_category: 'other',
  status: 'planning',
  start_date: '',
  end_date: '',
  estimated_cost: '',
  actual_cost: '',
  notes: '',
};

export default function ManageProjects() {
  const {
    projects,
    addProject,
    updateProject,
    deleteProject,
    refreshProjects,
    getTransactionsByProject,
    getProjectCosts,
  } = useDatabaseContext();

  const [open, setOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState<ProjectFormData>(INITIAL_FORM_DATA);
  const [projectTransactions, setProjectTransactions] = useState<{ [key: string]: any[] }>({});
  const [projectCosts, setProjectCosts] = useState<{ [key: string]: any }>({});

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    // Load transactions and costs for all projects
    const loadProjectData = async () => {
      const transactionsData: { [key: string]: any[] } = {};
      const costsData: { [key: string]: any } = {};

      for (const project of projects) {
        transactionsData[project.id] = await getTransactionsByProject(project.id);
        costsData[project.id] = await getProjectCosts(project.id);
      }

      setProjectTransactions(transactionsData);
      setProjectCosts(costsData);
    };

    if (projects.length > 0) {
      loadProjectData();
    }
  }, [projects, getTransactionsByProject, getProjectCosts]);

  const handleOpen = (project?: Project) => {
    if (project) {
      setEditingProject(project);
      setFormData({
        name: project.name,
        company_name: project.company_name,
        contact_details: project.contact_details,
        project_category: project.project_category,
        status: project.status,
        start_date: project.start_date || '',
        end_date: project.end_date || '',
        estimated_cost: project.estimated_cost?.toString() || '',
        actual_cost: project.actual_cost?.toString() || '',
        notes: project.notes || '',
      });
    } else {
      setEditingProject(null);
      setFormData(INITIAL_FORM_DATA);
    }
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setEditingProject(null);
    setFormData(INITIAL_FORM_DATA);
  };
  const handleSubmit = async () => {
    try {
      const projectData = {
        name: formData.name.trim(),
        company_name: formData.company_name.trim(),
        contact_details: formData.contact_details.trim(),
        project_category: formData.project_category,
        status: formData.status,
        start_date: formData.start_date.trim() || undefined,
        end_date: formData.end_date.trim() || undefined,
        estimated_cost: formData.estimated_cost.trim() ? parseFloat(formData.estimated_cost) : undefined,
        actual_cost: formData.actual_cost.trim() ? parseFloat(formData.actual_cost) : undefined,
        notes: formData.notes.trim() || undefined,
      };

      console.log('Submitting project data:', projectData);

      if (editingProject) {
        await updateProject(editingProject.id, projectData);
      } else {
        await addProject(projectData);
      }

      handleClose();
    } catch (error) {
      console.error('Failed to save project:', error);
    }
  };

  const handleDelete = async (project: Project) => {
    if (confirm(`Are you sure you want to delete "${project.name}"? This will remove project references from linked transactions.`)) {
      try {
        await deleteProject(project.id);
      } catch (error) {
        console.error('Failed to delete project:', error);
      }
    }
  };

  const handleInputChange = (field: keyof ProjectFormData) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const getStatusColor = (status: Project['status']) => {
    return PROJECT_STATUSES.find(s => s.value === status)?.color || '#9e9e9e';
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };
  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box sx={{ 
        display: 'flex', 
        flexDirection: { xs: 'column', sm: 'row' },
        justifyContent: 'space-between', 
        alignItems: { xs: 'stretch', sm: 'center' }, 
        mb: 3,
        gap: { xs: 2, sm: 0 }
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HomeIcon color="primary" />
          <Typography 
            variant="h4" 
            component="h1"
            sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}
          >
            House Projects
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpen()}
          size="small"
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          Add Project
        </Button>
      </Box>

      {projects.length === 0 ? (        <Alert severity="info" sx={{ mt: 2 }}>
          No projects yet. Click &quot;Add Project&quot; to create your first house project.
        </Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {projects.map((project) => {
            const costs = projectCosts[project.id] || { estimated: 0, actual: 0, transactions_total: 0 };
            const transactions = projectTransactions[project.id] || [];            return (
              <Card key={project.id}>
                <CardContent>
                  <Box sx={{ 
                    display: 'flex', 
                    flexDirection: { xs: 'column', sm: 'row' },
                    justifyContent: 'space-between', 
                    alignItems: { xs: 'stretch', sm: 'flex-start' }, 
                    mb: 2,
                    gap: { xs: 2, sm: 0 }
                  }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h6" component="h2" gutterBottom>
                        {project.name}
                      </Typography>
                      <Typography variant="subtitle1" color="text.secondary" gutterBottom>
                        {project.company_name}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                        <Chip
                          label={PROJECT_CATEGORIES.find(c => c.value === project.project_category)?.label || project.project_category}
                          size="small"
                          variant="outlined"
                        />
                        <Chip
                          label={PROJECT_STATUSES.find(s => s.value === project.status)?.label || project.status}
                          size="small"
                          sx={{ 
                            backgroundColor: getStatusColor(project.status),
                            color: 'white',
                          }}
                        />
                      </Box>
                    </Box>
                    <Box sx={{ 
                      display: 'flex', 
                      gap: 1,
                      justifyContent: { xs: 'flex-end', sm: 'flex-start' }
                    }}>
                      <IconButton
                        size="small"
                        onClick={() => handleOpen(project)}
                        color="primary"
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(project)}
                        color="error"
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                  </Box>

                  <Box sx={{ 
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                    gap: 2, 
                    mb: 2 
                  }}>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Estimated Cost
                      </Typography>
                      <Typography variant="h6">
                        {costs.estimated > 0 ? formatCurrency(costs.estimated) : 'Not set'}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Actual Cost
                      </Typography>
                      <Typography variant="h6">
                        {costs.actual > 0 ? formatCurrency(costs.actual) : 'Not set'}
                      </Typography>
                    </Box>
                    <Box sx={{ minWidth: 150 }}>
                      <Typography variant="body2" color="text.secondary">
                        Transaction Total
                      </Typography>
                      <Typography variant="h6" color={costs.transactions_total > 0 ? 'error.main' : 'text.primary'}>
                        {formatCurrency(costs.transactions_total)}
                      </Typography>
                    </Box>
                  </Box>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">
                        Project Details & Transactions ({transactions.length})
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                        <Box sx={{ flex: 1, minWidth: 250 }}>
                          <Typography variant="subtitle2" gutterBottom>
                            Contact Details
                          </Typography>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                            {project.contact_details}
                          </Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 250 }}>
                          <Typography variant="subtitle2" gutterBottom>
                            Timeline
                          </Typography>
                          <Typography variant="body2">
                            Start: {project.start_date || 'Not set'}
                          </Typography>
                          <Typography variant="body2">
                            End: {project.end_date || 'Not set'}
                          </Typography>
                        </Box>
                      </Box>
                      {project.notes && (
                        <Box sx={{ mb: 2 }}>
                          <Typography variant="subtitle2" gutterBottom>
                            Notes
                          </Typography>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                            {project.notes}
                          </Typography>
                        </Box>
                      )}

                      {transactions.length > 0 && (
                        <>
                          <Divider sx={{ my: 2 }} />
                          <Typography variant="subtitle2" gutterBottom>
                            Linked Transactions
                          </Typography>
                          <List dense>
                            {transactions.map((transaction) => (
                              <ListItem key={transaction.id} divider>
                                <ListItemText
                                  primary={transaction.description}
                                  secondary={`${transaction.date} • ${formatCurrency(Math.abs(transaction.amount))}`}
                                />
                              </ListItem>
                            ))}
                          </List>
                        </>
                      )}
                    </AccordionDetails>
                  </Accordion>
                </CardContent>
              </Card>
            );
          })}
        </Box>
      )}

      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingProject ? 'Edit Project' : 'Add New Project'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              fullWidth
              label="Project Name"
              value={formData.name}
              onChange={handleInputChange('name')}
              required
            />
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                sx={{ flex: 1, minWidth: 250 }}
                label="Company Name"
                value={formData.company_name}
                onChange={handleInputChange('company_name')}
                required
              />
              <FormControl sx={{ flex: 1, minWidth: 250 }} required>
                <InputLabel>Project Category</InputLabel>
                <Select
                  value={formData.project_category}
                  label="Project Category"
                  onChange={(e) => setFormData(prev => ({ ...prev, project_category: e.target.value as Project['project_category'] }))}
                >
                  {PROJECT_CATEGORIES.map((category) => (
                    <MenuItem key={category.value} value={category.value}>
                      {category.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            <TextField
              fullWidth
              label="Contact Details"
              value={formData.contact_details}
              onChange={handleInputChange('contact_details')}
              multiline
              rows={3}
              placeholder="Phone, email, address, etc."
              required
            />
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <FormControl sx={{ flex: 1, minWidth: 250 }}>
                <InputLabel>Status</InputLabel>
                <Select
                  value={formData.status}
                  label="Status"
                  onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as Project['status'] }))}
                >
                  {PROJECT_STATUSES.map((status) => (
                    <MenuItem key={status.value} value={status.value}>
                      {status.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                sx={{ flex: 1, minWidth: 250 }}
                label="Start Date"
                type="date"
                value={formData.start_date}
                onChange={handleInputChange('start_date')}
                InputLabelProps={{ shrink: true }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                sx={{ flex: 1, minWidth: 250 }}
                label="End Date"
                type="date"
                value={formData.end_date}
                onChange={handleInputChange('end_date')}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                sx={{ flex: 1, minWidth: 250 }}
                label="Estimated Cost"
                type="number"
                value={formData.estimated_cost}
                onChange={handleInputChange('estimated_cost')}
                InputProps={{ startAdornment: '$' }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                sx={{ flex: 1, minWidth: 250 }}
                label="Actual Cost"
                type="number"
                value={formData.actual_cost}
                onChange={handleInputChange('actual_cost')}
                InputProps={{ startAdornment: '$' }}
              />
            </Box>
            <TextField
              fullWidth
              label="Notes"
              value={formData.notes}
              onChange={handleInputChange('notes')}
              multiline
              rows={3}
              placeholder="Additional notes about the project..."
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={!formData.name || !formData.company_name || !formData.contact_details}
          >
            {editingProject ? 'Update' : 'Add'} Project
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
