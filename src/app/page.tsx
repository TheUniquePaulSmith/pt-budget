'use client';

import React, { useState } from 'react';
import { 
  Box, 
  AppBar, 
  Toolbar, 
  IconButton, 
  Typography, 
  Menu, 
  MenuItem, 
  Button,
  useTheme,
  useMediaQuery,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider
} from '@mui/material';
import { 
  Settings, 
  Menu as MenuIcon, 
  Dashboard as DashboardIcon,
  Home as ProjectsIcon,
  Receipt as TransactionsIcon,
  Storage as ManageDataIcon,
  BugReport
} from '@mui/icons-material';
import DatabaseInitializer from '../components/DatabaseInitializer';
import Dashboard from '../components/Dashboard';
import ManageProjects from '../components/ManageProjects';
import TransactionReport from '../components/TransactionReport';
import SettingsPage from '../components/SettingsPage';
import ManageData from '../components/ManageData';
import DeveloperConsolePage from '../components/DeveloperConsolePage';
import { useDatabaseContext } from '../contexts/DatabaseContext';

export default function Home() {
  const { isDatabaseLoaded } = useDatabaseContext();
  const [showDashboard, setShowDashboard] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [showSettings, setShowSettings] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [manageDataOpen, setManageDataOpen] = useState(false);
  const [showDeveloperConsole, setShowDeveloperConsole] = useState(false);
  
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const navigationItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
    { id: 'projects', label: 'Projects', icon: <ProjectsIcon /> },
    { id: 'transactions', label: 'Transactions', icon: <TransactionsIcon /> },
  ];

  const handleDatabaseReady = () => {
    setShowDashboard(true);
  };

  const handlePageChange = (page: string) => {
    setCurrentPage(page);
    setMobileMenuOpen(false);
  };

  const handleMobileMenuToggle = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  if (!isDatabaseLoaded && !showDashboard) {
    return (
      <Box>
        <DatabaseInitializer onDatabaseLoaded={handleDatabaseReady} />
      </Box>
    );
  }

  if (showSettings) {
    return <SettingsPage onClose={() => setShowSettings(false)} />;
  }

  if (showDeveloperConsole) {
    return <DeveloperConsolePage onClose={() => setShowDeveloperConsole(false)} />;
  }

  const renderNavigationButtons = () => (
    <>
      {navigationItems.map((item) => (
        <Button
          key={item.id}
          color="inherit"
          startIcon={item.icon}
          onClick={() => handlePageChange(item.id)}
          sx={{
            mx: 1,
            bgcolor: currentPage === item.id ? 'action.selected' : 'transparent',
            '&:hover': {
              bgcolor: 'action.hover',
            },
          }}
        >
          {item.label}
        </Button>
      ))}
    </>
  );

  const renderMobileDrawer = () => (
    <Drawer
      anchor="left"
      open={mobileMenuOpen}
      onClose={() => setMobileMenuOpen(false)}
      sx={{
        '& .MuiDrawer-paper': {
          width: 250,
          boxSizing: 'border-box',
        },
      }}
    >
      <Box sx={{ overflow: 'auto' }}>
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" component="div">
            Budget Tracker
          </Typography>
        </Box>
        <Divider />
        <List>
          {navigationItems.map((item) => (
            <ListItem key={item.id} disablePadding>
              <ListItemButton
                selected={currentPage === item.id}
                onClick={() => handlePageChange(item.id)}
              >
                <ListItemIcon>
                  {item.icon}
                </ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
        <Divider />
        <List>
          {isDatabaseLoaded && (
            <ListItem disablePadding>
              <ListItemButton onClick={() => { setManageDataOpen(true); setMobileMenuOpen(false); }}>
                <ListItemIcon>
                  <ManageDataIcon />
                </ListItemIcon>
                <ListItemText primary="Manage Data" />
              </ListItemButton>
            </ListItem>
          )}
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setShowDeveloperConsole(true); setMobileMenuOpen(false); }}>
              <ListItemIcon>
                <BugReport />
              </ListItemIcon>
              <ListItemText primary="Developer Console" />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setShowSettings(true); setMobileMenuOpen(false); }}>
              <ListItemIcon>
                <Settings />
              </ListItemIcon>
              <ListItemText primary="Settings" />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>
    </Drawer>
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Responsive App Bar */}
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar sx={{ minHeight: 64 }}>
          {isMobile && (
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={handleMobileMenuToggle}
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
          )}
          
          <Typography
            variant="h6"
            component="div"
            sx={{
              flexGrow: isMobile ? 1 : 0,
              mr: { xs: 0, md: 3 },
              fontWeight: 600,
              minWidth: 'fit-content',
            }}
          >
            Budget Tracker
          </Typography>

          {!isMobile && (
            <Box sx={{ flexGrow: 1, display: 'flex', ml: 2, minWidth: 0 }}>
              {renderNavigationButtons()}
            </Box>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 'fit-content' }}>
            {!isMobile && isDatabaseLoaded && (
              <IconButton
                color="inherit"
                onClick={() => setManageDataOpen(true)}
                sx={{ ml: 2 }}
                title="Manage Data"
              >
                <ManageDataIcon />
              </IconButton>
            )}
            {!isMobile && (
              <IconButton
                color="inherit"
                onClick={() => setShowDeveloperConsole(true)}
                sx={{ ml: 2 }}
                title="Developer Console"
              >
                <BugReport />
              </IconButton>
            )}
            {!isMobile && (
              <IconButton
                color="inherit"
                onClick={() => setShowSettings(true)}
                sx={{ ml: 2 }}
                title="Settings"
              >
                <Settings />
              </IconButton>
            )}
          </Box>
        </Toolbar>
      </AppBar>

      {/* Mobile Navigation Drawer */}
      {isMobile && renderMobileDrawer()}
      
      {/* Page Content */}
      {currentPage === 'dashboard' && (
        <Dashboard />
      )}
      
      {currentPage === 'projects' && (
        <ManageProjects />
      )}
      
      {currentPage === 'transactions' && (
        <TransactionReport />
      )}

      {/* Manage Data Dialog */}
      <ManageData
        open={manageDataOpen}
        onClose={() => setManageDataOpen(false)}
      />
    </Box>
  );
}
