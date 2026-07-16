import { DatabaseProvider } from "../../contexts/DatabaseContext";

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <DatabaseProvider>{children}</DatabaseProvider>;
}
