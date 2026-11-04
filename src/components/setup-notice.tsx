export function SetupNotice() {
  return (
    <div className="mx-auto mt-20 max-w-lg rounded-xl border bg-card p-6 text-sm">
      <h1 className="mb-2 text-lg font-semibold">Configuração pendente</h1>
      <p className="text-muted-foreground">
        O Supabase ainda não está conectado. Crie o arquivo <code>.env.local</code> com{" "}
        <code>NEXT_PUBLIC_SUPABASE_URL</code> e <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (veja <code>.env.example</code>),
        aplique <code>supabase/migrations/0001_schema.sql</code> e reinicie o servidor. Nenhum dado de exemplo é exibido.
      </p>
    </div>
  )
}
