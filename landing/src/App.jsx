import { useEffect, useState } from "react";

const navLinks = [
  { label: "Características", href: "#caracteristicas" },
  { label: "Precios", href: "#precios" },
  { label: "Casos de uso", href: "#casos" },
];

const trustLogos = [
  "Ferretería",
  "Restaurante",
  "Boutique",
  "Eventos",
  "Seguridad",
];

const steps = [
  {
    number: "01",
    title: "Sube tus imágenes",
    description:
      "Carga las páginas de tu catálogo, menú o revista y ordénalas en una experiencia lista para publicar.",
    icon: UploadIcon,
  },
  {
    number: "02",
    title: "Personaliza tu flipbook",
    description:
      "Ajusta portada, colores, enlaces y detalles visuales para que tu marca se vea más profesional.",
    icon: SparklesIcon,
  },
  {
    number: "03",
    title: "Comparte el link",
    description:
      "Publica tu flipbook y compártelo por WhatsApp, redes, correo o desde tu página web.",
    icon: ShareIcon,
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
  "Catálogos de productos",
  "Menús de restaurante",
  "Portafolios",
  "Revistas digitales",
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
    name: "Paola Jiménez",
    role: "Gerente comercial",
    company: "Boutique Caribe",
    quote:
      "Ahora enviamos el catálogo por WhatsApp y la presentación se siente mucho más premium que un PDF tradicional.",
  },
  {
    name: "Luis de León",
    role: "Director de mercadeo",
    company: "Eventos Capital RD",
    quote:
      "El flipbook nos ayudó a presentar propuestas con más impacto visual y una imagen mucho más profesional.",
  },
  {
    name: "María Abreu",
    role: "Propietaria",
    company: "Sabores del Patio",
    quote:
      "Usamos Intap Flip para el menú y para promociones. Es rápido, fácil de compartir y se ve excelente en móvil.",
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
              <div className="hero-orbit orbit-one"></div>
              <div className="hero-orbit orbit-two"></div>
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

                  <div className="grid gap-4 lg:grid-cols-[0.22fr_0.78fr]">
                    <div className="rounded-3xl border border-white/10 bg-white/5 p-3">
                      <div className="space-y-3">
                        {[1, 2, 3, 4].map((item) => (
                          <div key={item} className="h-16 rounded-2xl bg-gradient-to-br from-white/15 to-cyan-400/15"></div>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4 rounded-3xl bg-slate-50 p-4 text-slate-900">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-[1.4rem] bg-gradient-to-br from-indigo-100 via-white to-cyan-100 p-5">
                          <span className="inline-flex rounded-full bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-primary">
                            Portada
                          </span>
                          <h2 className="mt-10 max-w-[10rem] text-3xl font-extrabold tracking-tight text-dark">
                            Tu catálogo ahora impacta mejor
                          </h2>
                          <p className="mt-4 text-sm leading-6 text-slate-600">
                            Presenta colecciones, menús y portafolios con una experiencia interactiva más atractiva.
                          </p>
                        </div>

                        <div className="grid gap-3">
                          <div className="h-32 rounded-[1.4rem] bg-gradient-to-br from-cyan-100 to-slate-100"></div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="h-24 rounded-[1.2rem] bg-gradient-to-br from-indigo-50 to-cyan-50"></div>
                            <div className="h-24 rounded-[1.2rem] bg-gradient-to-br from-emerald-50 to-slate-100"></div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <InfoMiniCard title="Efecto real" text="Paso de página fluido" />
                        <InfoMiniCard title="Link listo" text="Compártelo al instante" />
                        <InfoMiniCard title="Responsive" text="Móvil, tablet y desktop" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute -bottom-5 left-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-lift">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tiempo de creación</p>
                <p className="text-lg font-bold text-dark">Menos de 10 minutos</p>
              </div>
              <div className="absolute -right-2 top-8 rounded-2xl border border-indigo-100 bg-white/95 px-4 py-3 shadow-lift">
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
              {trustLogos.map((item) => (
                <div
                  key={item}
                  className="flex min-h-20 items-center justify-center rounded-3xl border border-slate-200 bg-slate-50 px-4 text-center text-sm font-bold text-slate-700"
                >
                  {item}
                </div>
              ))}
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
            {useCases.map((item, index) => (
              <article
                key={item}
                className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white transition hover:-translate-y-1 hover:shadow-lift"
                data-reveal
              >
                <div
                  className={`h-44 bg-gradient-to-br ${
                    [
                      "from-indigo-200 via-white to-cyan-100",
                      "from-warning/30 via-white to-amber-100",
                      "from-emerald-100 via-white to-cyan-100",
                      "from-slate-200 via-white to-indigo-100",
                    ][index]
                  }`}
                ></div>
                <div className="p-6">
                  <h3 className="text-xl font-bold tracking-tight text-dark">{item}</h3>
                  <p className="mt-3 leading-7 text-slate-600">
                    Ideal para compartir contenido con mejor presencia digital y una imagen más cuidada.
                  </p>
                </div>
              </article>
            ))}
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
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-lg font-extrabold text-white">
                    {item.name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)}
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

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 16V4"></path>
      <path d="M7 9l5-5 5 5"></path>
      <path d="M4 20h16"></path>
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z"></path>
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"></path>
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 12l8-5"></path>
      <path d="M8 12l8 5"></path>
      <circle cx="6" cy="12" r="2.5"></circle>
      <circle cx="18" cy="7" r="2.5"></circle>
      <circle cx="18" cy="17" r="2.5"></circle>
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
