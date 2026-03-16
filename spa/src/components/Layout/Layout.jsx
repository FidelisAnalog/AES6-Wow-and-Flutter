import { Box } from '@mui/material';
import useQueryParams from '../../hooks/useQueryParams.js';
import Header from './Header.jsx';
import Footer from './Footer.jsx';

export default function Layout({ children }) {
  const { embed, hidePanel } = useQueryParams();

  const showHeader = !embed && !hidePanel.includes('header');
  const showFooter = !embed && !hidePanel.includes('footer');

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        maxWidth: 900,
        mx: 'auto',
        px: embed ? 0 : 3,
        py: embed ? 0 : 2,
      }}
    >
      {showHeader && <Header />}
      <Box component="main" sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </Box>
      {showFooter && <Footer />}
    </Box>
  );
}
