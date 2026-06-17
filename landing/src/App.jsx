import { useEffect, useState } from "react";

const navLinks = [
  { label: "Características", href: "#caracteristicas" },
  { label: "Precios", href: "#precios" },
  { label: "Casos de uso", href: "#casos" },
];

const trustLogos = [
  { name: "Ferretería Don Carlos", icon: HardwareLogoIcon },
  { name: "Restaurante El Mangú", icon: RestaurantLogoIcon },
  { name: "Boutique Bella RD", icon: BoutiqueLogoIcon },
  { name: "Eventos Reales", icon: EventsLogoIcon },
  { name: "SecureRD", icon: SecurityLogoIcon },
];

const steps = [
  {
    number: "01",
    title: "Sube tus imágenes",
    description:
      "Carga las páginas de tu catálogo, menú o revista y ordénalas en una experiencia lista para publicar.",
    icon: CloudUploadAnimatedIcon,
  },
  {
    number: "02",
    title: "Personaliza tu flipbook",
    description:
      "Ajusta portada, colores, enlaces y detalles visuales para que tu marca se vea más profesional.",
    icon: CursorCustomizeAnimatedIcon,
  },
  {
    number: "03",
    title: "Comparte el link",
    description:
      "Publica tu flipbook y compártelo por WhatsApp, redes, correo o desde tu página web.",
    icon: ShareLinkAnimatedIcon,
  },
];

const features = [
  ["Efecto de página real", "Haz que tu contenido se sienta más dinámico, moderno y agradable de explorar."],
  ["Editor en línea", "Actualiza tus flipbooks desde el navegador sin depender de procesos técnicos complejos."],
  ["Links activos en páginas", "Lleva a tus clientes a productos, formularios o canales de contacto desde cada página."],
  ["Formulario de contacto integrado", "Convierte visitas en oportunidades sin sacar al usuario de la experiencia."],
  ["Estadísticas de vistas", "Descubre qué contenido recibe más atención y toma mejores decisiones comerciales."],
  ["Marca de agua removible", "Proyecta una presentación más limpia, profesional y alineada con tu marca."],
];

const useCases = [
  {
    title: "Catálogos de productos",
    description:
      "Ideal para compartir líneas de productos con mejor presencia digital y enlaces hacia ventas.",
    gradient: "from-indigo-700 via-primary to-indigo-500",
    icon: CatalogUseCaseIcon,
  },
  {
    title: "Menús de restaurante",
    description:
      "Presenta menús visuales y promociones en un formato cómodo para móvil y fácil de compartir.",
    gradient: "from-amber-500 via-warning to-orange-400",
    icon: MenuUseCaseIcon,
  },
  {
    title: "Portafolios",
    description:
      "Muestra proyectos, trabajos y piezas visuales con una experiencia más profesional y ordenada.",
    gradient: "from-cyan-600 via-accent to-sky-400",
    icon: PortfolioUseCaseIcon,
  },
  {
    title: "Revistas digitales",
    description:
      "Convierte ediciones completas en una experiencia de lectura más inmersiva y elegante.",
    gradient: "from-violet-700 via-fuchsia-600 to-purple-500",
    icon: MagazineUseCaseIcon,
  },
];

const pricingPlans = [
  {
    name: "Free",
    price: "$0",
    period: "",
    featured: false,
    items: ["1 flipbook", "10 páginas", "Marca de agua Intap", "Link público"],
  },
  {
    name: "Basic",
    price: "$9.99",
    period: "/mes",
    featured: true,
    items: ["5 flipbooks", "50 páginas", "Sin marca de agua", "Sonido al voltear", "Estadísticas"],
  },
  {
    name: "Pro",
    price: "$29.99",
    period: "/mes",
    featured: false,
    items: [
      "Flipbooks ilimitados",
      "Páginas ilimitadas",
      "Editor avanzado",
      "Dominio personalizado",
      "Soporte prioritario",
    ],
  },
];

const testimonials = [
  {
    name: "María Rodríguez",
    initials: "MR",
    role: "Gerente comercial",
    company: "Bella Casa RD",
    quote:
      "Ahora enviamos el catálogo por WhatsApp y la presentación se siente mucho más premium que un PDF tradicional.",
    gradient: "from-primary to-violet-500",
  },
  {
    name: "Carlos Martínez",
    initials: "CM",
    role: "Director de mercadeo",
    company: "Eventos Reales",
    quote:
      "El flipbook nos ayudó a presentar propuestas con más impacto visual y una imagen mucho más profesional.",
    gradient: "from-accent to-sky-500",
  },
  {
    name: "Ana Pérez",
    initials: "AP",
    role: "Propietaria",
    company: "Sabores del Patio",
    quote:
      "Usamos Intap Flip para el menú y para promociones. Es rápido, fácil de compartir y se ve excelente en móvil.",
    gradient: "from-emerald-500 to-cyan-500",
  },
];

const registerUrl = "https://studio.flip.intaprd.com/register";

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
      { threshold: 0.18 }
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
    <div className="min-h-screen bg-surface text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-sm font-extrabold text-white shadow-glow">
              IF
            </span>
            <span className="text-lg font-extrabold tracking-tight text-dark">Intap Flip</span>
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
                  className="rounded-full px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-dark"
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <a
                href={registerUrl}
                className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-white shadow-glow transition hover:-translate-y-0.5 hover:bg-indigo-600"
                onClick={() => setMenuOpen(false)}
              >
                Comenzar gratis
              </a>
            </div>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="bg-hero-grid">
          <div className="mx-auto grid w-full max-w-7xl gap-14 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
            <div className="flex flex-col justify-center" data-reveal>
              <span className="mb-5 inline-flex w-fit rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-primary">
                Flipbooks para negocios en República Dominicana y Latinoamérica
              </span>
              <h1 className="max-w-3xl text-5xl font-extrabold tracking-tight text-dark sm:text-6xl lg:text-7xl">
                Crea catálogos digitales que enamoran
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
                Convierte tus imágenes en flipbooks interactivos con efecto de página real.
                Sin código, en minutos.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={registerUrl}
                  className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-4 text-base font-bold text-white shadow-glow transition hover:-translate-y-0.5 hover:bg-indigo-600"
                >
                  Crear mi flipbook gratis
                </a>
                <a
                  href="#demo"
                  className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-4 text-base font-bold text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-400"
                >
                  Ver demo
                </a>
              </div>

              <div className="mt-8 flex flex-wrap gap-3 text-sm font-medium text-slate-600">
                <Badge text="Sin código" tone="indigo" />
                <Badge text="Compatible móvil" tone="cyan" />
                <Badge text="Listo para compartir" tone="emerald" />
              </div>
            </div>

            <div className="relative" data-reveal id="demo">
              <div className="absolute -left-6 top-12 hidden h-28 w-28 rounded-full bg-cyan-200/60 blur-3xl lg:block"></div>
              <div className="absolute -right-4 bottom-10 hidden h-32 w-32 rounded-full bg-indigo-300/60 blur-3xl lg:block"></div>
              <div className="hero-orbit orbit-one hidden lg:block"></div>
              <div className="hero-orbit orbit-two hidden lg:block"></div>
              <div className="animate-float rounded-[2rem] border border-slate-200 bg-white p-4 shadow-lift">
                <div className="rounded-[1.6rem] bg-dark p-4 text-white">
                  <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">Demo flipbook</p>
                      <p className="mt-1 text-lg font-bold">Colección Primavera 2026</p>
                    </div>
                    <span className="rounded-full bg-success/20 px-3 py-1 text-xs font-semibold text-emerald-300">
                      Publicado
                    </span>
                  </div>

                  <div className="mb-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs font-semibold text-slate-200">
                      Link público
                    </span>
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                      Compatible móvil
                    </span>
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                      Sin código
                    </span>
                  </div>

                  <HeroFlipbookMockup />
                </div>
              </div>

              <div className="absolute -bottom-5 left-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-lift">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tiempo de creación</p>
                <p className="text-lg font-bold text-dark">Menos de 10 minutos</p>
              </div>
              <div className="absolute right-3 top-3 hidden rounded-2xl border border-indigo-100 bg-white/95 px-4 py-3 shadow-lift sm:block lg:-right-2 lg:top-8">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Ideal para</p>
                <p className="text-sm font-bold text-dark">Catálogos, menús y portafolios</p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" data-reveal>
            <p className="text-center text-sm font-semibold uppercase tracking-[0.25em] text-slate-500">
              Usado por negocios en República Dominicana
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {trustLogos.map((item) => {
                const Icon = item.icon;
                return (
                <div
                  key={item.name}
                  className="flex min-h-24 flex-col items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 text-center text-sm font-bold text-slate-700 transition hover:-translate-y-1 hover:shadow-lift"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                    <Icon />
                  </span>
                  <span>{item.name}</span>
                </div>
                );
              })}
            </div>
          </div>
        </section>

        <SectionBlock
          id="como-funciona"
          eyebrow="Cómo funciona"
          title="Publica un flipbook profesional sin complicarte con procesos técnicos."
          description="El flujo está pensado para negocios que quieren verse mejor, compartir más rápido y vender con mejor apoyo visual."
        >
          <div className="grid gap-5 lg:grid-cols-3">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <article
                  key={step.number}
                  className="group rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lift"
                  data-reveal
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-primary">
                      <Icon />
                    </span>
                    <span className="text-sm font-bold tracking-[0.2em] text-slate-400">{step.number}</span>
                  </div>
                  <h3 className="mt-6 text-2xl font-bold tracking-tight text-dark">{step.title}</h3>
                  <p className="mt-3 text-base leading-7 text-slate-600">{step.description}</p>
                </article>
              );
            })}
          </div>
        </SectionBlock>

        <SectionBlock
          id="caracteristicas"
          eyebrow="Características"
          title="Funciones pensadas para presentar mejor tu contenido y mover más oportunidades."
          description="Cada herramienta está orientada a hacer tus catálogos, menús y materiales comerciales más útiles y más atractivos."
        >
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {features.map(([title, text], index) => (
              <article
                key={title}
                className="group rounded-[2rem] border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:shadow-lift"
                data-reveal
              >
                <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                  0{index + 1}
                </span>
                <h3 className="mt-5 text-xl font-bold tracking-tight text-dark">{title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </SectionBlock>

        <SectionBlock
          id="casos"
          eyebrow="Casos de uso"
          title="Desde catálogos hasta revistas, el formato se adapta a distintos tipos de negocio."
          description="La idea es simple: transformar archivos estáticos en experiencias visuales más cómodas de explorar y compartir."
        >
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {useCases.map((item) => {
              const Icon = item.icon;
              return (
              <article
                key={item.title}
                className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white transition hover:-translate-y-1 hover:shadow-lift"
                data-reveal
              >
                <div className={`relative flex h-44 items-center justify-center overflow-hidden bg-gradient-to-br ${item.gradient}`}>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_28%)]"></div>
                  <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full border border-white/20"></div>
                  <div className="absolute -bottom-10 -left-4 h-32 w-32 rounded-full border border-white/10"></div>
                  <span className="relative text-white/95">
                    <Icon />
                  </span>
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-bold tracking-tight text-dark">{item.title}</h3>
                  <p className="mt-3 leading-7 text-slate-600">{item.description}</p>
                </div>
              </article>
              );
            })}
          </div>
        </SectionBlock>

        <SectionBlock
          id="precios"
          eyebrow="Precios"
          title="Empieza gratis y elige el plan que mejor se adapte al ritmo de tu negocio."
          description="Planes claros para probar la plataforma, crecer con más publicaciones y mejorar tu presencia digital."
        >
          <div className="grid gap-6 xl:grid-cols-3">
            {pricingPlans.map((plan) => (
              <article
                key={plan.name}
                className={`pricing-card relative rounded-[2rem] border p-8 transition hover:-translate-y-1 hover:shadow-lift ${
                  plan.featured
                    ? "border-primary bg-dark text-white shadow-glow"
                    : "border-slate-200 bg-white text-dark"
                }`}
                data-reveal
              >
                {plan.featured ? (
                  <span className="absolute right-6 top-6 rounded-full bg-cyan-400 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-950">
                    Más popular
                  </span>
                ) : null}
                <h3 className="text-2xl font-bold">{plan.name}</h3>
                <div className="mt-4 flex items-end gap-1">
                  <span className="text-5xl font-extrabold tracking-tight">{plan.price}</span>
                  {plan.period ? (
                    <span className={plan.featured ? "pb-2 text-slate-300" : "pb-2 text-slate-500"}>
                      {plan.period}
                    </span>
                  ) : null}
                </div>
                <p className={`mt-4 text-sm leading-6 ${plan.featured ? "text-slate-300" : "text-slate-500"}`}>
                  {plan.name === "Free"
                    ? "Para probar la experiencia y empezar a compartir."
                    : plan.name === "Basic"
                      ? "La mejor opción para negocios que ya publican con frecuencia."
                      : "Pensado para equipos con alto volumen y más personalización."}
                </p>
                <ul className="mt-8 space-y-4">
                  {plan.items.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <span
                        className={`mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full ${
                          plan.featured ? "bg-white/15 text-emerald-300" : "bg-emerald-50 text-success"
                        }`}
                      >
                        <CheckIcon />
                      </span>
                      <span className={plan.featured ? "text-slate-200" : "text-slate-600"}>{item}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={registerUrl}
                  className={`mt-8 inline-flex w-full items-center justify-center rounded-full px-5 py-4 text-base font-bold transition hover:-translate-y-0.5 ${
                    plan.featured
                      ? "bg-white text-dark hover:bg-slate-100"
                      : "bg-primary text-white hover:bg-indigo-600"
                  }`}
                >
                  Comenzar
                </a>
              </article>
            ))}
          </div>
        </SectionBlock>

        <SectionBlock
          id="testimonios"
          eyebrow="Testimonios"
          title="Una herramienta pensada para negocios que quieren presentar mejor lo que venden."
          description="Ejemplos de cómo puede sentirse el impacto comercial de una presentación más moderna y compartible."
        >
          <div className="grid gap-5 xl:grid-cols-3">
            {testimonials.map((item) => (
              <article
                key={item.name}
                className="testimonial-card rounded-[2rem] border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:shadow-lift"
                data-reveal
              >
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex gap-1 text-warning">
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                  </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                      Cliente
                    </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className={`testimonial-avatar flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ${item.gradient} text-lg font-extrabold text-white`}>
                    {item.initials}
                  </div>
                  <div>
                    <h3 className="font-bold text-dark">{item.name}</h3>
                    <p className="text-sm text-slate-500">
                      {item.role} · {item.company}
                    </p>
                  </div>
                </div>
                <p className="mt-5 leading-7 text-slate-600">“{item.quote}”</p>
              </article>
            ))}
          </div>
        </SectionBlock>

        <section className="px-4 pb-20 sm:px-6 lg:px-8">
          <div
            className="mx-auto max-w-7xl overflow-hidden rounded-[2.5rem] bg-gradient-to-r from-dark via-primary to-indigo-700 px-6 py-12 text-white shadow-glow sm:px-10 lg:px-14 lg:py-16"
            data-reveal
          >
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-cyan-200">CTA final</p>
              <h2 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
                ¿Listo para crear tu primer flipbook?
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-indigo-100">
                Empieza gratis y convierte tus catálogos, menús o portafolios en experiencias digitales que se ven mejor y se comparten fácil.
              </p>
              <a
                href={registerUrl}
                className="mt-8 inline-flex items-center justify-center rounded-full bg-white px-6 py-4 text-base font-bold text-primary transition hover:-translate-y-0.5 hover:bg-slate-100"
              >
                Crear cuenta gratis
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-sm font-extrabold text-white">
                IF
              </span>
              <span className="text-lg font-extrabold tracking-tight text-dark">Intap Flip</span>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              © 2026 Intap Flip · PGC Soluciones · Santo Domingo, RD
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-semibold text-slate-600">
            <a href="#top" className="transition hover:text-primary">
              Términos
            </a>
            <a href="#top" className="transition hover:text-primary">
              Privacidad
            </a>
            <a href="mailto:contacto@intaprd.com" className="transition hover:text-primary">
              Contacto
            </a>
            <a href="#top" className="transition hover:text-primary">
              Instagram
            </a>
            <a href="#top" className="transition hover:text-primary">
              LinkedIn
            </a>
            <a href="#top" className="transition hover:text-primary">
              Facebook
            </a>
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
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-primary">{eyebrow}</p>
          <h2 className="mt-4 text-4xl font-extrabold tracking-tight text-dark sm:text-5xl">{title}</h2>
          <p className="mt-5 text-lg leading-8 text-slate-600">{description}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

function Badge({ text, tone }) {
  const tones = {
    indigo: "border-indigo-200 bg-indigo-50 text-primary",
    cyan: "border-cyan-200 bg-cyan-50 text-cyan-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };

  return (
    <span className={`rounded-full border px-4 py-2 ${tones[tone]}`}>
      {text}
    </span>
  );
}

function InfoMiniCard({ title, text }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-bold text-dark">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  );
}

function HeroFlipbookMockup() {
  return (
    <div className="grid gap-4 lg:grid-cols-[0.22fr_0.78fr]">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-3">
        <div className="space-y-3">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="flex h-16 items-center gap-3 rounded-2xl bg-gradient-to-br from-white/10 to-cyan-400/15 px-3">
              <div className="h-10 w-8 rounded-lg bg-white/20"></div>
              <div className="flex-1 space-y-2">
                <div className="h-2.5 w-3/4 rounded-full bg-white/25"></div>
                <div className="h-2.5 w-1/2 rounded-full bg-cyan-300/25"></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 rounded-3xl bg-slate-50 p-4 text-slate-900">
        <div className="rounded-[1.6rem] bg-gradient-to-br from-indigo-100 via-white to-cyan-100 p-4">
          <svg viewBox="0 0 760 420" className="hero-book-svg w-full">
            <defs>
              <linearGradient id="coverGlow" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#4F46E5" />
                <stop offset="100%" stopColor="#06B6D4" />
              </linearGradient>
              <linearGradient id="pageTint" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="100%" stopColor="#E0F2FE" />
              </linearGradient>
              <filter id="bookShadow" x="-20%" y="-20%" width="140%" height="160%">
                <feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#0F172A" floodOpacity="0.18" />
              </filter>
            </defs>

            <ellipse cx="380" cy="360" rx="250" ry="26" fill="#0F172A" opacity="0.12" />
            <g filter="url(#bookShadow)">
              <path d="M114 116C114 97 130 82 149 82H364V330H149C130 330 114 315 114 296V116Z" fill="url(#pageTint)" />
              <path d="M646 116C646 97 630 82 611 82H396V330H611C630 330 646 315 646 296V116Z" fill="url(#pageTint)" />
              <path d="M379 82H396V330H379Z" fill="#D7E0EA" />
              <path d="M160 110H334V306H160C151 306 144 299 144 290V126C144 117 151 110 160 110Z" fill="url(#coverGlow)" />
              <path d="M428 110H600C609 110 616 117 616 126V290C616 299 609 306 600 306H428V110Z" fill="#FFFFFF" />
              <path className="page-flip" d="M396 106C475 118 528 150 574 222C528 282 472 305 396 314V106Z" fill="url(#pageTint)" stroke="#CFE8F8" strokeWidth="2" />
            </g>

            <g>
              <rect x="184" y="140" width="92" height="16" rx="8" fill="white" fillOpacity="0.88" />
              <rect x="184" y="173" width="118" height="12" rx="6" fill="white" fillOpacity="0.64" />
              <rect x="184" y="200" width="78" height="12" rx="6" fill="#BAE6FD" />
              <rect x="184" y="234" width="130" height="46" rx="16" fill="white" fillOpacity="0.22" />
              <rect x="442" y="136" width="130" height="88" rx="18" fill="#DBEAFE" />
              <rect x="442" y="242" width="62" height="44" rx="14" fill="#E0F2FE" />
              <rect x="516" y="242" width="62" height="44" rx="14" fill="#EEF2FF" />
              <rect x="590" y="242" width="62" height="44" rx="14" fill="#D1FAE5" />
              <rect x="442" y="304" width="170" height="10" rx="5" fill="#CBD5E1" />
            </g>
          </svg>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <InfoMiniCard title="Efecto real" text="Paso de página fluido" />
          <InfoMiniCard title="Link listo" text="Compártelo al instante" />
          <InfoMiniCard title="Responsive" text="Móvil, tablet y desktop" />
        </div>
      </div>
    </div>
  );
}

function CloudUploadAnimatedIcon() {
  return (
    <svg viewBox="0 0 48 48" className="icon-float h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M15 35H34C39 35 43 31 43 26C43 21.7 39.8 18 35.6 17.3C34.9 11.5 30 7 24 7C18.6 7 14 10.7 12.7 15.8C7.9 16.3 4 20.4 4 25.3C4 30.7 8.3 35 13.7 35H15Z"></path>
      <path d="M24 31V16"></path>
      <path d="M18.5 21.5L24 16L29.5 21.5"></path>
    </svg>
  );
}

function CursorCustomizeAnimatedIcon() {
  return (
    <svg viewBox="0 0 48 48" className="icon-pulse h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="7" y="8" width="34" height="25" rx="6"></rect>
      <path d="M16 18H26"></path>
      <path d="M16 24H22"></path>
      <path d="M29 19L23 38L28 35L31 41L35 39L32 33L37 33L29 19Z" fill="currentColor" stroke="none"></path>
    </svg>
  );
}

function ShareLinkAnimatedIcon() {
  return (
    <svg viewBox="0 0 48 48" className="icon-slide h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M18 17H14C9.6 17 6 20.6 6 25C6 29.4 9.6 33 14 33H20"></path>
      <path d="M30 17H34C38.4 17 42 20.6 42 25C42 29.4 38.4 33 34 33H28"></path>
      <path d="M17 25H31"></path>
      <path d="M29 20L34 25L29 30"></path>
    </svg>
  );
}

function CatalogUseCaseIcon() {
  return (
    <svg viewBox="0 0 80 80" className="h-24 w-24" fill="none">
      <rect x="12" y="16" width="40" height="48" rx="10" fill="white" fillOpacity="0.18" stroke="white" strokeWidth="2.4" />
      <rect x="20" y="24" width="24" height="6" rx="3" fill="white" fillOpacity="0.95" />
      <rect x="20" y="36" width="24" height="18" rx="6" fill="white" fillOpacity="0.28" />
      <path d="M55 24L68 31V49L55 56L42 49V31L55 24Z" fill="white" fillOpacity="0.95" />
      <path d="M52 40H58" stroke="#4F46E5" strokeWidth="3" strokeLinecap="round" />
      <path d="M55 37V43" stroke="#4F46E5" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function MenuUseCaseIcon() {
  return (
    <svg viewBox="0 0 80 80" className="h-24 w-24" fill="none">
      <circle cx="40" cy="42" r="18" fill="white" fillOpacity="0.18" stroke="white" strokeWidth="2.4" />
      <circle cx="40" cy="42" r="10" fill="white" fillOpacity="0.92" />
      <path d="M20 18V36" stroke="white" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M16 18V26" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M20 18V26" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M24 18V26" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M60 18V38" stroke="white" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M56 18C56 14.7 58.7 12 62 12V25C62 28.3 59.3 31 56 31" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PortfolioUseCaseIcon() {
  return (
    <svg viewBox="0 0 80 80" className="h-24 w-24" fill="none">
      <rect x="12" y="22" width="56" height="38" rx="10" fill="white" fillOpacity="0.18" stroke="white" strokeWidth="2.4" />
      <path d="M30 22V18C30 14.7 32.7 12 36 12H44C47.3 12 50 14.7 50 18V22" stroke="white" strokeWidth="2.4" />
      <rect x="20" y="30" width="18" height="12" rx="4" fill="white" fillOpacity="0.95" />
      <path d="M45 48L52 40L60 50" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="49" cy="33" r="4" fill="white" fillOpacity="0.9" />
    </svg>
  );
}

function MagazineUseCaseIcon() {
  return (
    <svg viewBox="0 0 80 80" className="h-24 w-24" fill="none">
      <path d="M12 20C12 16.7 14.7 14 18 14H38V60H18C14.7 60 12 57.3 12 54V20Z" fill="white" fillOpacity="0.18" stroke="white" strokeWidth="2.4" />
      <path d="M68 20C68 16.7 65.3 14 62 14H42V60H62C65.3 60 68 57.3 68 54V20Z" fill="white" fillOpacity="0.18" stroke="white" strokeWidth="2.4" />
      <path d="M23 24H32" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M48 24H57" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="21" y="31" width="13" height="18" rx="4" fill="white" fillOpacity="0.92" />
      <rect x="46" y="31" width="13" height="18" rx="4" fill="white" fillOpacity="0.92" />
    </svg>
  );
}

function HardwareLogoIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 9L13 14"></path>
      <path d="M10 7L15 12"></path>
      <path d="M19 7L25 13L14 24L8 18L19 7Z"></path>
    </svg>
  );
}

function RestaurantLogoIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 6V16"></path>
      <path d="M6 6V11"></path>
      <path d="M9 6V11"></path>
      <path d="M12 6V11"></path>
      <path d="M22 6V18"></path>
      <path d="M19 6C19 4 20.8 3 22 3V10C22 12.2 20.2 14 18 14"></path>
    </svg>
  );
}

function BoutiqueLogoIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 13L10 8H22L24 13"></path>
      <path d="M7 13H25V24H7V13Z"></path>
      <path d="M13 13C13 15 14.3 16 16 16C17.7 16 19 15 19 13"></path>
    </svg>
  );
}

function EventsLogoIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4V28"></path>
      <path d="M16 7C19 9 21 12 21 15C21 18 19 21 16 23"></path>
      <path d="M16 7C13 9 11 12 11 15C11 18 13 21 16 23"></path>
      <circle cx="16" cy="15" r="9"></circle>
    </svg>
  );
}

function SecurityLogoIcon() {
  return (
    <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4L24 7V14C24 20 20 24 16 27C12 24 8 20 8 14V7L16 4Z"></path>
      <path d="M13 15L15 17L19 13"></path>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M5 12l4.2 4.2L19 6.5"></path>
    </svg>
  );
}

export default App;
