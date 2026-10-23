import { pageTitle } from "./styles";

/**
 * A page's title and its buttons. The buttons wrap under the title on a phone instead of
 * squeezing it (five of them used to push "+ New" off the screen), and sit beside it on
 * anything wider.
 */
export function PageHeader({ title, children, className = "" }: { title: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-3 ${className}`}>
      <h1 className={`${pageTitle} mr-auto min-w-0 break-words`}>{title}</h1>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
