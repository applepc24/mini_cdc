import "./login.css";

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="login-theme min-h-screen">{children}</div>;
}