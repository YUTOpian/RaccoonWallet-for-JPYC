import { Snackbar, Alert } from '@mui/material';

interface ErrorSnackbarProps {
  message: string;
  onClose: () => void;
}

/**
 * Ported from src/components/mixins/MessageModule.ts (showError). That mixin just opened
 * a Vuetify snackbar with the given text; this is the same behavior via MUI's Snackbar.
 */
export default function ErrorSnackbar({ message, onClose }: ErrorSnackbarProps) {
  return (
    <Snackbar open={message.length > 0} autoHideDuration={4000} onClose={onClose}>
      <Alert severity="error" onClose={onClose} sx={{ width: '100%' }}>{message}</Alert>
    </Snackbar>
  );
}
