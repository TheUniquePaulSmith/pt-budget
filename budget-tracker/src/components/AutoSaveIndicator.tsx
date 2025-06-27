'use client';

import React, { useState } from 'react';
import {
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  Typography,
  Box,
  Divider,
} from '@mui/material';
import {
  Save,
  SaveAlt,
  CloudOff,
} from '@mui/icons-material';
import { useDatabaseContext } from '../contexts/DatabaseContext';

const AutoSaveIndicator: React.FC = () => {  const {
    autoSaveEnabled,
    autoSaveFileHandle,
    lastAutoSave,
    enableAutoSave,
    disableAutoSave,
  } = useDatabaseContext();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };
  const handleEnableAutoSave = async () => {
    try {
      const success = await enableAutoSave();
      if (success) {
        console.log('Auto-save enabled from indicator');
      }
    } catch (error) {
      console.error('Error enabling auto-save:', error);
    }
    handleClose();
  };
  const handleDisableAutoSave = () => {
    disableAutoSave();
    handleClose();
  };
  const getTooltipContent = () => {
    if (!('showSaveFilePicker' in window)) {
      return (
        <div>
          Auto-save not available
          <br />
          Browser not supported
        </div>
      );
    } else if (autoSaveEnabled && autoSaveFileHandle) {
      return (
        <div>
          Auto-save enabled
          <br />
          Saving to: {autoSaveFileHandle.name}
          {lastAutoSave && (
            <>
              <br />
              Last saved: {lastAutoSave.toLocaleString()}
            </>
          )}
        </div>
      );
    } else if (autoSaveEnabled) {
      return (
        <div>
          Auto-save enabled
          <br />
          File location unknown
          {lastAutoSave && (
            <>
              <br />
              Last saved: {lastAutoSave.toLocaleString()}
            </>
          )}
        </div>
      );
    } else {
      return (
        <div>
          Auto-save disabled
          <br />
          Click to enable
        </div>
      );
    }
  };

  const getIcon = () => {
    if (!('showSaveFilePicker' in window)) {
      return <CloudOff color="disabled" />;
    } else if (autoSaveEnabled) {
      return <Save color="success" />;
    } else {
      return <CloudOff color="action" />;
    }
  };  return (
    <>
      <Tooltip 
        title={getTooltipContent()}
        placement="bottom"
      >
        <IconButton
          color="inherit"
          onClick={handleClick}
          sx={{ 
            ml: 1,
            width: 40,
            height: 40,
          }}
        >
          {getIcon()}
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        disableScrollLock={true}
        slotProps={{
          paper: {
            sx: {
              maxWidth: 300,
              mt: 0.5,
            }
          }
        }}
      ><Box sx={{ px: 2, py: 1, minWidth: 250 }}>
          <Typography variant="subtitle2" gutterBottom>
            Auto-Save Status
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {!('showSaveFilePicker' in window) 
              ? 'Not available (Browser not supported)'
              : autoSaveEnabled ? 'Enabled' : 'Disabled'
            }
          </Typography>          {autoSaveEnabled && autoSaveFileHandle && (
            <Typography variant="body2" color="text.secondary" gutterBottom>
              <strong>File:</strong> {autoSaveFileHandle.name}
            </Typography>
          )}
          {autoSaveEnabled && lastAutoSave && (
            <Typography variant="body2" color="text.secondary" gutterBottom>
              <strong>Last saved:</strong> {lastAutoSave.toLocaleString()}
            </Typography>
          )}
        </Box>
        <Divider />
        {!('showSaveFilePicker' in window) ? (
          <MenuItem disabled>
            <CloudOff sx={{ mr: 1 }} />
            Browser not supported
          </MenuItem>
        ) : autoSaveEnabled ? (
          <MenuItem onClick={handleDisableAutoSave}>
            <CloudOff sx={{ mr: 1 }} />
            Disable Auto-Save
          </MenuItem>
        ) : (
          <MenuItem onClick={handleEnableAutoSave}>
            <SaveAlt sx={{ mr: 1 }} />
            Enable Auto-Save
          </MenuItem>
        )}
      </Menu>
    </>
  );
};

export default AutoSaveIndicator;
