export default function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs font-semibold text-red-600 dark:text-red-400 text-center">
      {message}
    </div>
  );
}
