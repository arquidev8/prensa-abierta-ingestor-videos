import { getInitials } from '@/lib/userDisplay';

export default function UserAvatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  const dims = size === 'lg' ? 'w-16 h-16 text-xl' : 'w-8 h-8 text-xs';
  return (
    <span
      className={`${dims} rounded-full bg-gradient-to-br from-[#FF5500] to-amber-400 text-white font-black flex items-center justify-center shrink-0 shadow-sm`}
    >
      {getInitials(name)}
    </span>
  );
}
