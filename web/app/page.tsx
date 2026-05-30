import { redirect } from "next/navigation";

// The middleware bounces unauthenticated users from /dashboard to /login.
export default function Home() {
  redirect("/dashboard");
}
