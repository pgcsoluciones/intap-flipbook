import { useEffect, useState } from "react";

const navLinks = [
  { label: "Características", href: "#caracteristicas" },
  { label: "Precios", href: "#precios" },
  { label: "Casos de uso", href: "#casos" },
];

const registerUrl = "https://studio.flip.intaprd.com/register";
const logoBlue = "/asset%20web/logo-intap-flip-azul.png";
const logoWhite = "/asset%20web/logo-intap-flip blanco-02.png";
const heroEditor = "/asset%20web/pantalla-central.png";

const heroBenefits = [
  "Convierte archivos PDF, PNG y JPG en flipbooks digitales atractivos",
  "Sube audio, videos y enlaces interactivos para captar más atención",
  "Facilita el contacto directo por WhatsApp y conecta tus redes sociales",
  "Comparte catálogos, menús o portafolios en segundos desde un solo enlace",
];

const featureCards = [
  {
    title: "Archivos listos para vender",
    text: "Transforma tus piezas estáticas en una experiencia visual más moderna y fácil de explorar.",
  },
  {
    title: "Contenido interactivo",
    text: "Agrega enlaces, video, audio y botones para guiar al cliente hacia la acción correcta.",
  },
  {
    title: "Contacto inmediato",
    text: "Conecta WhatsApp y redes sociales para que cada visita pueda convertirse en conversación.",
  },
  {
    title: "Un solo enlace",
    text: "Comparte catálogos, menús o portafolios sin enviar archivos pesados ni versiones desactualizadas.",
  },
];

const steps = [
  ["01", "Sube tu contenido", "Carga PDF, PNG o JPG y organiza tus páginas."],
  ["02", "Activa interacciones", "Añade enlaces, multimedia, WhatsApp y redes."],
  ["03", "Comparte y convierte", "Publica tu enlace y úsalo en WhatsApp, redes o web."],
];

const useCases = [
  ["Catálogos", "Muestra productos con una presentación visual y fácil de compartir."],
  ["Menús", "Publica menús digitales con promociones, enlaces y contacto directo."],
  ["Portafolios", "Presenta trabajos y propuestas con más orden e impacto profesional."],
  ["Revistas", "Convierte ediciones digitales en una experiencia de lectura más atractiva."],
];

const pricingPlans = [
  {
    name: "Free",
    price: "$0",
    period: "",
    description: "Para probar la experiencia y publicar tu primer flipbook.",
    items: ["1 flipbook", "10 páginas", "Link público", "Marca Intap"],
  },
  {
    name: "Basic",
    price: "$9.99",
    period: "/mes",
    description: "Para negocios que necesitan compartir contenido con frecuencia.",
    featured: true,
    items: ["5 flipbooks", "50 páginas", "Sin marca de agua", "Estadísticas básicas"],
  },
  {
    name: "Pro",
    price: "$29.99",
    period: "/mes",
    description: "Para equipos que necesitan más publicaciones y personalización.",
    items: ["Flipbooks ilimitados", "Páginas ilimitadas", "Dominio personalizado", "Soporte prioritario"],
  },
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16 }
    );

    const elements = document.querySelectorAll("[data-reveal]");
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const closeMenu = () => setMenuOpen(false);
    window.addEventListener("resize", closeMenu);
    return () => window.removeEventListener("resize", closeMenu);
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex items-center">
            <img src={logoBlue} alt="Intap Flip" className="h-10 w-auto sm:h-11" />
          </a>

          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-700 lg:hidden"
            aria-label="Abrir menú"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <div className="space-y-1.5">
              <span className="block h-0.5 w-5 rounded-full bg-current"></span>
              <span className="block h-0.5 w-5 rounded-full bg-current"></span>
            </div>
          </button>

          <nav
            className={`absolute left-4 right-4 top-full mt-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-lift transition lg:static lg:mt-0 lg:flex lg:items-center lg:gap-2 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none ${
              menuOpen ? "block" : "hidden lg:flex"
            }`}
          >
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-full px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <a
                href={registerUrl}
                className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-blue transition hover:-translate-y-0.5 hover:bg-blue-700"
                onClick={() => setMenuOpen(false)}
              >
                Comenzar gratis
              </a>
            </div>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="clean-hero overflow-hidden px-4 py-12 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div className="clean-hero-copy" data-reveal>
              <h1 className="text-5xl font-extrabold leading-[0.98] tracking-tight text-black sm:text-6xl lg:text-7xl">
                Creador de
                <span className="block">Flipbook en línea</span>
              </h1>
              <p className="mt-6 bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl lg:text-5xl">
                Crea, diseña y comparte
              </p>

              <ul className="mt-8 space-y-5 text-base leading-7 text-slate-700 sm:text-lg">
                {heroBenefits.map((benefit) => (
                  <li key={benefit} className="flex gap-4">
                    <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-600">
                      <CheckIcon />
                    </span>
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-9 flex flex-col gap-4 sm:flex-row">
                <a
                  href={registerUrl}
                  className="inline-flex items-center justify-center rounded-2xl bg-blue-600 px-8 py-4 text-base font-bold text-white shadow-blue transition hover:-translate-y-0.5 hover:bg-blue-700"
                >
                  Crear ahora
                </a>
                <a
                  href="#demo"
                  className="inline-flex items-center justify-center gap-3 rounded-2xl border border-blue-500 bg-white px-8 py-4 text-base font-bold text-blue-600 transition hover:-translate-y-0.5 hover:bg-blue-50"
                >
                  <span className="text-lg">▶</span>
                  Ver demo
                </a>
              </div>
            </div>

            <div className="clean-hero-visual" data-reveal id="demo">
              <div className="editor-window">
                <div className="editor-dots" aria-hidden="true">
                  <span className="bg-red-400"></span>
                  <span className="bg-amber-400"></span>
                  <span className="bg-emerald-400"></span>
                </div>
                <img src={heroEditor} alt="Editor de Intap Flip" className="editor-image" />
                <div className="page-curl" aria-hidden="true"></div>
              </div>

              <div className="floating-format-card" aria-label="Formatos soportados">
                <MiniFormat icon="📄" label="PDF" tone="red" />
                <MiniFormat icon="🖼️" label="PNG / JPG" tone="violet" />
                <MiniFormat icon="🎵" label="Audio" tone="green" />
                <MiniFormat icon="🎬" label="Video" tone="blue" />
              </div>

              <div className="floating-social-card" aria-label="Contacto y redes">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-600">
                  <span>☘</span>
                  <span>WhatsApp</span>
                </div>
                <div className="mt-3 flex gap-2 text-xs font-extrabold text-white">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-pink-500">IG</span>
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-600">f</span>
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-sky-600">in</span>
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-500">Redes sociales</p>
              </div>

              <div className="floating-book-icon" aria-hidden="true">▰</div>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-2 xl:grid-cols-4" data-reveal>
            {featureCards.map((item) => (
              <article key={item.title} className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lift">
                <h3 className="text-xl font-bold tracking-tight text-slate-950">{item.title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <SectionBlock
          id="caracteristicas"
          eyebrow="Características"
          title="Herramientas claras para convertir tu contenido en una experiencia compartible."
          description="Intap Flip está pensado para presentar mejor, conectar más rápido y facilitar el contacto desde cualquier canal."
        >
          <div className="grid gap-5 lg:grid-cols-3">
            {steps.map(([number, title, text]) => (
              <article key={number} className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm" data-reveal>
                <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-blue-600">{number}</span>
                <h3 className="mt-6 text-2xl font-bold tracking-tight text-slate-950">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </SectionBlock>

        <SectionBlock
          id="casos"
          eyebrow="Casos de uso"
          title="Un formato para catálogos, menús, portafolios y revistas digitales."
          description="Ideal para negocios que necesitan compartir contenido visual sin complicar al cliente."
        >
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {useCases.map(([title, text]) => (
              <article key={title} className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6" data-reveal>
                <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-white text-2xl shadow-sm">▣</div>
                <h3 className="text-xl font-bold tracking-tight text-slate-950">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </SectionBlock>

        <SectionBlock
          id="precios"
          eyebrow="Precios"
          title="Empieza gratis y crece cuando tu negocio lo necesite."
          description="Planes claros para publicar, compartir y mejorar tu presencia digital sin procesos técnicos."
        >
          <div className="grid gap-6 xl:grid-cols-3">
            {pricingPlans.map((plan) => (
              <article
                key={plan.name}
                className={`relative rounded-[2rem] border p-8 transition hover:-translate-y-1 hover:shadow-lift ${
                  plan.featured ? "border-blue-600 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-950"
                }`}
                data-reveal
              >
                {plan.featured ? (
                  <span className="absolute right-6 top-6 rounded-full bg-blue-500 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white">
                    Más popular
                  </span>
                ) : null}
                <h3 className="text-2xl font-bold">{plan.name}</h3>
                <div className="mt-4 flex items-end gap-1">
                  <span className="text-5xl font-extrabold tracking-tight">{plan.price}</span>
                  {plan.period ? <span className="pb-2 opacity-70">{plan.period}</span> : null}
                </div>
                <p className={`mt-4 text-sm leading-6 ${plan.featured ? "text-slate-300" : "text-slate-500"}`}>{plan.description}</p>
                <ul className="mt-8 space-y-4">
                  {plan.items.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <span className={`mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full ${plan.featured ? "bg-white/15 text-emerald-300" : "bg-emerald-50 text-emerald-600"}`}>
                        <CheckIcon />
                      </span>
                      <span className={plan.featured ? "text-slate-200" : "text-slate-600"}>{item}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={registerUrl}
                  className={`mt-8 inline-flex w-full items-center justify-center rounded-2xl px-5 py-4 text-base font-bold transition hover:-translate-y-0.5 ${
                    plan.featured ? "bg-white text-slate-950 hover:bg-slate-100" : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  Comenzar
                </a>
              </article>
            ))}
          </div>
        </SectionBlock>

        <section className="px-4 pb-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl overflow-hidden rounded-[2.5rem] bg-gradient-to-r from-slate-950 via-blue-700 to-violet-700 px-6 py-12 text-white shadow-blue sm:px-10 lg:px-14 lg:py-16" data-reveal>
            <div className="max-w-3xl">
              <img src={logoWhite} alt="Intap Flip" className="h-10 w-auto" />
              <h2 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl">¿Listo para crear tu primer flipbook?</h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-blue-100">
                Convierte tus catálogos, menús o portafolios en experiencias digitales listas para compartir y generar contacto.
              </p>
              <a href={registerUrl} className="mt-8 inline-flex items-center justify-center rounded-2xl bg-white px-6 py-4 text-base font-bold text-blue-700 transition hover:-translate-y-0.5 hover:bg-slate-100">
                Crear cuenta gratis
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <img src={logoBlue} alt="Intap Flip" className="h-10 w-auto" />
            <p className="mt-3 text-sm text-slate-500">© 2026 Intap Flip · PGC Soluciones · Santo Domingo, RD</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold text-slate-600">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="transition hover:text-blue-600">{link.label}</a>
            ))}
            <a href="mailto:contacto@intaprd.com" className="transition hover:text-blue-600">Contacto</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionBlock({ id, eyebrow, title, description, children }) {
  return (
    <section id={id} className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 max-w-3xl" data-reveal>
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-blue-600">{eyebrow}</p>
          <h2 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl">{title}</h2>
          <p className="mt-5 text-lg leading-8 text-slate-600">{description}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

function MiniFormat({ icon, label, tone }) {
  const tones = {
    red: "bg-red-500",
    violet: "bg-violet-600",
    green: "bg-emerald-500",
    blue: "bg-blue-500",
  };

  return (
    <div className="flex items-center gap-3">
      <span className={`grid h-9 w-9 place-items-center rounded-xl text-base text-white ${tones[tone]}`}>{icon}</span>
      <span className="text-base font-bold text-slate-700">{label}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.3">
      <path d="M4.5 10.5L8.2 14L15.5 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default App;
