import { useState, useCallback, useRef } from 'react';
import { Paper, Typography } from '@mui/material';
import { CloudUpload } from '@mui/icons-material';

/**
 * Drag-drop zone + click-to-browse for WAV/FLAC files.
 * The visual drop target — page-level drop is wired in App.jsx.
 *
 * @param {{ onFileSelected: (file: File) => void, disabled: boolean }} props
 */
export default function FileInput({ onFileSelected, disabled }) {
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
    // Reset so the same file can be re-selected
    e.target.value = '';
  }, [onFileSelected]);

  return (
    <>
      <Paper
        variant="outlined"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        sx={{
          p: 4,
          textAlign: 'center',
          cursor: disabled ? 'default' : 'pointer',
          border: '2px dashed',
          borderColor: dragOver ? 'primary.main' : 'divider',
          bgcolor: dragOver ? 'action.hover' : 'background.paper',
          opacity: disabled ? 0.5 : 1,
          pointerEvents: disabled ? 'none' : 'auto',
          transition: 'border-color 0.2s, background-color 0.2s',
        }}
      >
        <CloudUpload sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
        <Typography color="text.secondary">
          Drop a WAV or FLAC file here, or click to browse
        </Typography>
      </Paper>
      <input
        ref={inputRef}
        type="file"
        accept=".wav,.flac"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </>
  );
}
