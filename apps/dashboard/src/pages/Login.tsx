import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res =
        mode === 'login'
          ? await api.auth.login(email, password)
          : await api.auth.register(email, password, name)
      localStorage.setItem('token', res.data.token)
      navigate('/')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h1 style={styles.logo}>📖 Intap Flipbook</h1>
        <h2 style={styles.title}>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h2>

        <form onSubmit={handleSubmit} style={styles.form}>
          {mode === 'register' && (
            <input
              style={styles.input}
              placeholder="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Contraseña"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? 'Cargando...' : mode === 'login' ? 'Entrar' : 'Registrarse'}
          </button>
        </form>

        <p style={styles.toggle}>
          {mode === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
          <button
            style={styles.link}
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}
          >
            {mode === 'login' ? 'Regístrate' : 'Inicia sesión'}
          </button>
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' },
  card: { background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 400, boxShadow: '0 4px 24px rgba(0,0,0,.08)' },
  logo: { textAlign: 'center', fontSize: '1.5rem', marginBottom: '0.5rem' },
  title: { textAlign: 'center', fontWeight: 600, marginBottom: '1.5rem', color: '#1a1a2e' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input: { padding: '0.75rem 1rem', borderRadius: 8, border: '1px solid #ddd', fontSize: '1rem', outline: 'none' },
  error: { color: '#e53e3e', fontSize: '0.875rem', margin: 0 },
  btn: { padding: '0.75rem', borderRadius: 8, background: '#4f46e5', color: '#fff', border: 'none', fontWeight: 600, fontSize: '1rem', cursor: 'pointer' },
  toggle: { textAlign: 'center', marginTop: '1rem', fontSize: '0.875rem', color: '#666' },
  link: { background: 'none', border: 'none', color: '#4f46e5', cursor: 'pointer', fontWeight: 600 },
}
