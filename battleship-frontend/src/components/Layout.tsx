import './Layout.css';

interface LayoutProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="studio">
      <main className="studio-main">{children}</main>
    </div>
  );
}
