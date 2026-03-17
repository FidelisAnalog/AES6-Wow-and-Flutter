import { useState, useCallback, useRef } from 'react';
import { Paper, Typography, Button, Box } from '@mui/material';
import { CloudUpload, FolderOpen } from '@mui/icons-material';

/**
 * Drag-drop zone + click-to-browse for WAV/FLAC files.
 * Two modes:
 *   compact=false (default): centered hero card for initial file selection
 *   compact=true: inline "Choose file" button for re-selection after load
 *
 * Page-level drop is also wired in App.jsx.
 */
export default function FileInput({ onFileSelected, disabled, compact = false }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && !disabled) onFileSelected(file);
  }, [onFileSelected, disabled]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) onFileSelected(file);
    e.target.value = '';
  }, [onFileSelected]);

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".wav,.flac"
      style={{ display: 'none' }}
      onChange={handleFileChange}
    />
  );

  if (compact) {
    return (
      <>
        <Button
          size="small"
          startIcon={<FolderOpen />}
          onClick={handleClick}
          disabled={disabled}
          sx={{ textTransform: 'none' }}
        >
          Choose file
        </Button>
        {hiddenInput}
      </>
    );
  }

  return (
    <Paper
      elevation={2}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        width: '50%',
        height: '50vh',
        mx: 'auto',
        my: 'auto',
        textAlign: 'center',
        cursor: disabled ? 'default' : 'pointer',
        border: '2px dashed',
        borderColor: dragOver ? 'primary.main' : 'divider',
        bgcolor: dragOver ? 'action.hover' : 'background.paper',
        opacity: disabled ? 0.5 : 1,
        transition: 'border-color 0.2s, background-color 0.2s',
      }}
    >
      <CloudUpload sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
      <Typography color="text.secondary">
        Drop a WAV file on the page, or click to browse
      </Typography>
      {hiddenInput}
    </Paper>
  );
}
