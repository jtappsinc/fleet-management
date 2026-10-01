import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const loginMutation = useLogin();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    loginMutation.mutate(
      { data: { email, password } },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          const params = new URLSearchParams(window.location.search);
          const raw = params.get("next");
          let next: string | null = null;
          if (raw) {
            try {
              const decoded = decodeURIComponent(raw);
              if (decoded.startsWith("/") && !decoded.startsWith("//")) {
                next = decoded;
              }
            } catch {
              next = null;
            }
          }
          setLocation(next ?? "/");
        },
        onError: () => setErrorMsg("Invalid email or password"),
      },
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3">
          <div className="flex items-center">
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="Joshua Tree"
              className="h-11 w-auto object-contain"
            />
          </div>
          <CardTitle className="font-serif text-3xl">Welcome back.</CardTitle>
          <CardDescription>
            Sign in to run the day. Customers, jobs, fleet, and the whole shop —
            in one place.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {errorMsg && (
              <Alert variant="destructive">
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
