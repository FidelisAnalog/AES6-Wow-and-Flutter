import { Box, Typography, Link } from '@mui/material';

export default function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        pt: 3,
        pb: 2,
        textAlign: 'center',
        borderTop: 1,
        borderColor: 'divider',
        mt: 'auto',
      }}
    >
      <Typography variant="caption" color="text.secondary">
        AES6-2008 / DIN 45507 / IEC 60386 conformant wow &amp; flutter analysis
      </Typography>
    </Box>
  );
}
