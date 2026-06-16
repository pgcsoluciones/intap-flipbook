import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { API_BASE } from '../lib/api'

export default function Register() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref) setReferralCode(ref)
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('El nombre es requerido')
      return
    }
    if (!email.trim()) {
      setError('El email es requerido')
      return
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)
    try {
      const body: Record<string, string> = { name: name.trim(), email, password }
      if (referralCode) body.referral_code = referralCode

      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      localStorage.setItem('token', data.data.token)
      navigate('/dashboard')
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
        <h2 style={styles.title}>Crear cuenta</h2>

        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            style={styles.input}
            placeholder="Nombre completo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
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
          <input
            style={styles.input}
            type="password"
            placeholder="Confirmar contraseña"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {referralCode && (
            <input
              style={{ ...styles.input, ...styles.inputReadonly }}
              type="text"
              value={`Referido por: ${referralCode}`}
              readOnly
            />
          )}
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? 'Cargando...' : 'Crear cuenta'}
          </button>
        </form>

        <p style={styles.toggle}>
          ¿Ya tenés cuenta?{' '}
          <Link to="/login" style={styles.link}>
            Iniciá sesión
          </Link>
        </p>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' },
  card: { background: '#fff', borderRadius: 12, padding: '2rem', width: '100%', maxWidth: 400, boxShadow: '0 4px 24px rgba(0,0,0,.08)' },
  logo: { textAlign: 'center', fontSize: '1.5rem', marginBottom: '0.5rem' },
  title: { textAlign: 'center', fontWeight: 600, marginBottom: '1.5rem', color: '#1a1a2e' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input: { padding: '0.75rem 1rem', borderRadius: 8, border: '1px solid #ddd', fontSize: '1rem', outline: 'none' },
  inputReadonly: { background: '#f1f5f9', color: '#64748b', cursor: 'default' },
  error: { color: '#e53e3e', fontSize: '0.875rem', margin: 0 },
  btn: { padding: '0.75rem', borderRadius: 8, background: '#4f46e5', color: '#fff', border: 'none', fontWeight: 600, fontSize: '1rem', cursor: 'pointer' },
  toggle: { textAlign: 'center', marginTop: '1rem', fontSize: '0.875rem', color: '#666' },
  link: { color: '#4f46e5', fontWeight: 600, textDecoration: 'none' },
}
