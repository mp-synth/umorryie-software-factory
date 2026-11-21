import { toast } from 'sonner';
import { copy } from '@/lib/utils';

export const toastError = (e: Error) => toast.error(e.message);

export const toastSuccess = (message: string) => () => toast.success(message);

export const copyWithToast = (text: string, message = 'Copied') => copy(text).then(() => toast.success(message));
