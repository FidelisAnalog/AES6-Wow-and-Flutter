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
      <Typography variant="caption" color="text.secondary" display="block">
        AES6-2008 / DIN 45507 / IEC 60386 / CCIR 409-2 Conformant
      </Typography>
      <Typography variant="caption" color="text.secondary">
        <Link href="https://github.com/FidelisAnalog/AES6-Wow-and-Flutter" target="_blank" rel="noopener" color="inherit" underline="hover">
          View on GitHub.
        </Link>
      </Typography>
    </Box>
  );
}
