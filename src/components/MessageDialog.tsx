import { Dialog, Box, Typography, Button, DialogActions } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import topIcon from '../assets/top_icon.png';

interface MessageDialogProps {
  open: boolean;
  title: string;
  texts: string[];
  onClose: () => void;
  onCancel?: () => void;
  selectable?: boolean;
  // 'error' swaps the header to a red warning treatment so mistakes (e.g. a wrong PIN)
  // are visually distinct from routine info/success dialogs at a glance, not just by
  // reading the title text.
  variant?: 'default' | 'error';
}

/**
 * Ported from src/components/parts/MessageDialog.vue. The Vue version supported paging
 * through multiple "pages" of lines (texts: string[][]) with swipeable tabs, for
 * multi-screen onboarding messages; this only needed a flat message list anywhere it was
 * actually used, so it's simplified to a single page of lines (texts: string[]).
 */
export default function MessageDialog({ open, title, texts, onClose, onCancel, selectable = false, variant = 'default' }: MessageDialogProps) {
  // Every caller of this component treats onClose as the "OK / proceed" action (there's
  // no separate confirm handler). That's fine for the plain (non-selectable) dialogs where
  // OK is the only way out. But for a selectable dialog, MUI's Dialog also fires onClose on
  // backdrop click / Escape - which would silently trigger the OK action just by dismissing
  // the dialog. Route that dismissal through onCancel instead so it behaves like CANCEL.
  const handleDialogClose = () => {
    if (selectable) {
      onCancel?.();
    } else {
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleDialogClose}>
      <Box sx={{ bgcolor: variant === 'error' ? 'error.main' : 'primary.main', width: '100%', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {variant === 'error' ? (
          <ErrorOutlineIcon sx={{ width: 36, height: 36, color: 'white' }} />
        ) : (
          <Box component="img" src={topIcon} sx={{ width: 40, height: 40 }} />
        )}
      </Box>
      <Box sx={{ bgcolor: 'white', p: 3 }}>
        <Typography variant="h6" align="center" sx={{ mb: 2, color: variant === 'error' ? 'error.main' : undefined }}>{title}</Typography>
        <Typography variant="body2" align="center" sx={{ color: 'textSlightGray' }}>
          {texts.map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
        </Typography>
        <DialogActions sx={{ justifyContent: 'center', mt: 2 }}>
          {selectable && (
            <Button color="secondary" onClick={() => onCancel?.()}>CANCEL</Button>
          )}
          <Button variant={selectable ? 'text' : 'contained'} color="primary" onClick={onClose}>OK</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
