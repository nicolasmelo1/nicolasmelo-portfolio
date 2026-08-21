export type PortfolioCapsule = {
  id: string;
  kind: "about" | "experience" | "education" | "project" | "skills" | "contact";
  title: string;
  summary: string;
  details?: string[];
  /** Employment dates, exactly as the profile states them. */
  period?: string;
  location?: string;
  tags: string[];
  aliases: string[];
  links?: Array<{ label: string; href: string }>;
};

/**
 * The only facts this portfolio can state.
 *
 * Every capsule below is drawn from a source: a repository description, a
 * README, or the LinkedIn profile its owner supplied. Nothing here is inferred
 * Dates, employers, locations and figures are as stated, not reconstructed.
 * The model is handed these and told it may not invent any of them, so anything
 * absent from this file simply cannot be said.
 */
export const portfolioCapsules: PortfolioCapsule[] = [
  {
    id: "about",
    kind: "about",
    title: "About Nicolas",
    summary:
      "Senior Software Engineer at Revv, based in São Paulo, Brazil. Interested in AI-native systems, agent infrastructure, developer tooling, architecture, and in how humans and agents build software together.",
    details: [
      "In his own words, on the subject of what he does: \"I like building stuff\".",
      "Ten years of shipping, from native mobile internships to founding a product and leading a backend team.",
      "Works in TypeScript, Python, Rust and Elixir, and has been remote since 2019.",
      "Speaks English, Portuguese and Spanish. Brazilian.",
    ],
    location: "São Paulo, Brazil",
    tags: ["software", "ai", "agents", "architecture", "developer tools", "sao paulo", "brazil"],
    aliases: [
      "who are you",
      "profile",
      "background",
      "what do you do",
      "where are you",
      "location",
      "based",
    ],
    links: [
      { label: "github.com/nicolasmelo1", href: "https://github.com/nicolasmelo1" },
      { label: "LinkedIn", href: "https://www.linkedin.com/in/nicolas-melo" },
    ],
  },
  {
    id: "exp-revv",
    kind: "experience",
    title: "Senior Software Engineer at Revv",
    summary: "Current role. Senior software engineer at Revv, full-time and remote.",
    period: "January 2026 to present",
    location: "New York, United States · Remote",
    tags: ["current", "senior", "revv", "remote"],
    aliases: [
      "current job",
      "where do you work",
      "revv",
      "current role",
      "what do you do now",
      "employer",
    ],
  },
  {
    id: "exp-seedify",
    kind: "experience",
    title: "Senior Backend Engineer at Seedify",
    summary:
      "Led the backend team on Web3 and blockchain services, acting as final technical approver on key engineering discussions and architectural changes.",
    details: [
      "Fully responsible for the backend of a new Bonding Curve feature.",
      "Operated and scaled event-driven components with RabbitMQ and BullMQ on NestJS, TypeORM and Redis.",
      "Cut API response times from roughly 1 s to 3–10 ms under peak load, through extensive caching and careful invalidation.",
      "Resolved concurrency and race conditions with database-level locks on inserts.",
      "Moved the codebase from JavaScript to TypeScript, which cut production bugs by 40%.",
      "Built decentralised sign-in with Web3 wallets and signature checks, so people prove who they are without giving up anonymity.",
      "Wrote and shipped smart contracts, wired into the backend, raising platform reliability by 35%.",
      "Set up the DevOps side with Pulumi, describing infrastructure as code. Deploys got 65% faster and running costs dropped by around $35,000 a year.",
      "TDD on every change, feature and bug fix.",
    ],
    period: "February 2025 to January 2026 · 1 year",
    location: "Remote",
    tags: ["backend", "web3", "blockchain", "nestjs", "redis", "rabbitmq", "performance", "leadership"],
    aliases: [
      "seedify",
      "web3",
      "blockchain",
      "backend",
      "bonding curve",
      "performance",
      "caching",
      "race conditions",
    ],
  },
  {
    id: "exp-mindcloud",
    kind: "experience",
    title: "Senior Software Engineer at MindCloud",
    summary:
      "Full-stack engineering on client integrations, in TypeScript, Node.js, React and PostgreSQL.",
    details: [
      "Reimagined the authentication system: researched, tested and implemented a more secure platform, then migrated user credentials onto it.",
      "Built an AI-powered app for live audio summarization and transcription in Slack channels, with React Native and Expo. It became one of the company's main revenue sources.",
      "Built bespoke integrations on Node.js, JavaScript and AWS, working directly with clients on requirements.",
      "Test-driven development throughout.",
    ],
    period: "November 2023 to February 2025 · 1 year 4 months",
    location: "United States · Remote",
    tags: ["full stack", "typescript", "react", "aws", "postgresql", "authentication", "ai"],
    aliases: ["mindcloud", "integrations", "authentication", "slack app", "transcription"],
  },
  {
    id: "exp-launchcode",
    kind: "experience",
    title: "Senior Software Engineer at Launchcode",
    summary:
      "Built a dating app for a startup from scratch, owning UI design, business logic, architecture on both ends, testing and technical leadership.",
    details: [
      "React Native, Expo, TypeScript, NestJS, Node.js, PostgreSQL, Redis and Websockets, with Jest and Storybook for testing.",
      "Infrastructure on AWS with Docker, Kubernetes, Pulumi and Turborepo.",
      "Set the long-term architecture for maintenance and scalability, and translated business requirements into technical specifications with product.",
      "Talked to clients directly to turn abstract specifications into releases.",
      "Four major releases shipped, and more than 2,000 new users in the first month after launch.",
    ],
    period: "June 2022 to September 2023 · 1 year 4 months",
    location: "Calgary, Alberta, Canada · Remote",
    tags: ["react native", "nestjs", "kubernetes", "aws", "architecture", "leadership", "mobile"],
    aliases: ["launchcode", "dating app", "react native", "mobile", "kubernetes", "pulumi"],
  },
  {
    id: "exp-reflow",
    kind: "experience",
    title: "Founder and CTO at Reflow",
    summary:
      "Founded Reflow and built the product from nothing: a platform whose clients defined their own fields and stored data dynamically.",
    details: [
      "Modelled the database for dynamic data, so clients could define fields and save against them at runtime.",
      "Wrote a custom full-stack framework in Node.js, and shared the same code between client and server, so a rule written once ran in both places.",
      "Designed a small language of its own, close to Excel formulas, so clients could build their own automations. It was later pulled out on its own as Flow.",
      "Built a WYSIWYG text editor from scratch in React and React Native, working the same way on web and on phones.",
      "Django, Django REST Framework, Node.js, Next.js, React, Expo and Styled-Components.",
      "Built CI/CD and cloud infrastructure with Jenkins and AWS, using Elastic Beanstalk, RDS, EC2, Route 53 and ElastiCache, plus Redis and Websockets for real-time.",
      "Streamlined the work enough to save about 30 hours a month without giving up quality.",
      "Managed a team of developers, designers and customer success.",
      "Reached 100 paying enterprise customers, with hundreds of companies using it in all, and became a technology partner of Startup SP, a Brazilian startup programme. It was discontinued for financial reasons.",
      "The code is still public, in three repositories: the Django server, the front end, and the monorepo that was Reflow 2.0.",
    ],
    period: "February 2019 to August 2022 · 3 years 7 months",
    location: "São Paulo, Brazil · Remote",
    tags: ["founder", "cto", "django", "node", "aws", "dsl", "framework", "startup"],
    links: [
      { label: "reflow_server (the Django backend)", href: "https://github.com/nicolasmelo1/reflow_server" },
      {
        label: "reflow_crm_front (Electron, React Native and Next.js in one repo)",
        href: "https://github.com/nicolasmelo1/reflow_crm_front",
      },
      {
        label: "reflow_monorepo (Reflow 2.0, front and back together)",
        href: "https://github.com/nicolasmelo1/reflow_monorepo",
      },
    ],
    aliases: [
      "reflow",
      "founder",
      "cto",
      "startup",
      "own company",
      "programming language",
      "no-code",
      "dynamic fields",
    ],
  },
  {
    id: "exp-teravoz",
    kind: "experience",
    title: "Full Stack Developer at Teravoz",
    summary:
      "Short stint building an analytics app for call-centre statistics, on a microservices architecture with React and Node.js.",
    details: [
      "The company was acquired by Twilio a few months after this work.",
    ],
    period: "January 2019 to February 2019 · 2 months",
    location: "São Paulo, Brazil · On-site",
    tags: ["analytics", "microservices", "react", "node"],
    aliases: ["teravoz", "analytics", "call center", "twilio", "microservices"],
  },
  {
    id: "exp-99",
    kind: "experience",
    title: "Software Engineer and Analytics Intern at 99",
    summary:
      "Two internships over one year and ten months at 99, moving from marketing analytics into engineering.",
    details: [
      "Software Engineer Intern (April 2018 to January 2019): maintained a Backbone.js app and helped modernise it towards Vue.js; worked on a Scala and Java data-processing application for the Brazilian market.",
      "Data & Marketing Analytics Intern (April 2017 to March 2018): fully automated performance reporting across Twitter Ads, Facebook Ads, Google AdWords, Adjust and AppsFlyer using Python, VBA and the ad APIs.",
      "Built and shipped a CRM platform for driver acquisition in Python.",
      "Standardised campaign taxonomies and wrote the algorithms that loaded performance data into the database.",
    ],
    period: "April 2017 to January 2019 · 1 year 10 months",
    location: "São Paulo, Brazil",
    tags: ["python", "analytics", "automation", "scala", "java", "vue", "internship"],
    aliases: ["99", "ninety nine", "didi", "analytics", "internship", "first job", "python"],
  },
  {
    id: "exp-onesight",
    kind: "experience",
    title: "Mobile Developer Intern at Onesight",
    summary:
      "First role: native mobile development for a consultancy's client, before React Native or Flutter existed as options.",
    details: [
      "Helped build both a native iOS app in Swift and a native Android app in Java for a home-care client.",
      "Alamofire, RxSwift, RxJava and Realm for on-device storage.",
      "Worked alongside two senior developers, one per platform.",
    ],
    period: "July 2016 to November 2016 · 5 months",
    location: "São Paulo, Brazil",
    tags: ["swift", "java", "ios", "android", "mobile", "internship"],
    aliases: ["onesight", "ios", "android", "swift", "native mobile", "earliest work"],
  },
  {
    id: "logion",
    kind: "project",
    title: "Logion",
    summary:
      "An open, versioned registry of AI-agent artifacts: skills, plugins, MCP servers and models, each with provenance and evidence attached, published over open protocols.",
    details: [
      "Starts from the question a registry usually leaves unanswered: does this actually work with my agent?",
      "Treats provenance and evidence as part of the artifact rather than as documentation around it.",
      "Publishes over open protocols instead of a single proprietary catalogue.",
    ],
    tags: ["ai agents", "registry", "python", "skills", "mcp", "provenance"],
    aliases: ["logion", "registry", "skills registry", "agent artifacts", "mcp servers"],
    links: [
      { label: "logion.sh", href: "https://www.logion.sh/" },
      { label: "GitHub", href: "https://github.com/nicolasmelo1/logion" },
    ],
  },
  {
    id: "software-factory",
    kind: "project",
    title: "software factory",
    summary:
      "A method for building software with agents, packaged as a single binary that runs against any repository.",
    details: [
      "Encodes important engineering rules twice: as prose explaining why and as executable checks that fail when violated.",
      "Adds mutation-based checks to prove that the safeguards actually fire.",
      "Treats the agent harness as productized infrastructure instead of ad-hoc prompts and glue scripts.",
    ],
    tags: ["agents", "developer tooling", "rust", "software quality", "automation"],
    aliases: ["software factory", "sf", "agent harness", "rules", "mutations", "checks"],
    links: [{ label: "GitHub", href: "https://github.com/nicolasmelo1/software-factory" }],
  },
  {
    id: "palmares",
    kind: "project",
    title: "Palmares",
    summary:
      "A JavaScript and TypeScript framework aimed at unification: bring your own tools and stop checking whether X works with Y.",
    details: [
      "Zero dependencies at its core, and designed to run anywhere JavaScript runs.",
      "Can be stripped apart. You do not need to use Palmares to use Palmares.",
      "Built for monorepos, and usable even without a server.",
      "Named after Zumbi dos Palmares and the quilombo: the theme is union and freedom of choice rather than another replacement tool.",
    ],
    tags: ["typescript", "javascript", "framework", "orm", "monorepo", "open source"],
    aliases: ["palmares", "framework", "js framework", "typescript framework", "unification"],
    links: [
      { label: "palmaresjs.com", href: "https://palmaresjs.com/" },
      { label: "GitHub", href: "https://github.com/palmaresHQ" },
    ],
  },
  {
    id: "reinforcement-learning-learnings",
    kind: "project",
    title: "Reinforcement learning learnings",
    summary:
      "Learning to build machines that learn, by working through a hands-on reinforcement learning course by hand rather than through the notebooks it ships with.",
    details: [
      "Follows the Hands-on RL course, reimplementing each part from scratch in an editor instead of running the provided notebooks.",
      "Python 3.12 with uv for the environment.",
      "Openly a learning repository, not a library.",
    ],
    tags: ["reinforcement learning", "python", "learning", "machine learning"],
    aliases: [
      "reinforcement learning",
      "rl",
      "machine learning",
      "learning rl",
      "q-learning",
      "studies",
    ],
    links: [
      { label: "GitHub", href: "https://github.com/nicolasmelo1/reinforcement-learning-learnings" },
    ],
  },
  {
    id: "palindrl",
    kind: "project",
    title: "palindromon-0.116M",
    summary:
      "A joke, taken seriously: a 116,101-parameter reinforcement learning policy whose entire job is deciding whether short strings are palindromes.",
    details: [
      "A decoder-only transformer with a policy head and a value head, which solves the task by walking two pointers inward.",
      "Its own model card says it is dumb and should not be taken seriously, and labels its benchmark comparisons as intentionally fake.",
      "Shipped with a demo Space, because a model with 0.116M parameters deserves a launch.",
    ],
    tags: ["reinforcement learning", "python", "toy model", "for fun"],
    aliases: ["palindrl", "palindromon", "palindrome", "joke", "for fun", "smallest model"],
    links: [
      { label: "GitHub", href: "https://github.com/nicolasmelo1/palindrl" },
      {
        label: "Demo",
        href: "https://huggingface.co/spaces/nicolasmelo/palindromon-0.116M-space",
      },
      { label: "Hugging Face", href: "https://huggingface.co/nicolasmelo" },
    ],
  },
  {
    id: "agent-era",
    kind: "project",
    title: "The Agent Era",
    summary:
      "A written argument about how companies should work with agents: the job is moving from using AI to managing agents, and every developer should have one of their own.",
    details: [
      "The point it makes: an agent is not a chat window or autocomplete. It is a persistent software coworker, a loop around a model with tools, memory, preferences, skills and permissions.",
      "The agent should belong to the developer, not to each product. One agent that can use Slack, GitHub, the terminal and CI beats one assistant per tool.",
      "Chat is where companies coordinate, so the agent should be reachable from chat even though the work happens elsewhere.",
      "It argues with numbers rather than vibes, and includes the ones that disagree with it: GitHub measured developers finishing a task 55.8% faster with Copilot, while a 2025 METR trial found experienced developers 19% slower in repositories they knew well.",
      "Its conclusion is that AI does not replace engineering judgement, it makes judgement matter more.",
    ],
    tags: ["ai agents", "essay", "developer experience", "orchestration", "opinion"],
    aliases: [
      "agent era",
      "agents at work",
      "how should companies use agents",
      "managing agents",
      "essay",
      "opinion",
    ],
    links: [{ label: "GitHub", href: "https://github.com/nicolasmelo1/agent-era" }],
  },
  {
    id: "rlmjs",
    kind: "project",
    title: "rlmjs",
    summary:
      "A Recursive Language Model, built in TypeScript on Bun. A model that handles long context by writing code to explore it, instead of reading all of it at once.",
    details: [
      "Ported from a Python implementation, and written with plain functions instead of classes.",
      "The original ran the model's code with eval on the main thread. This one runs it in a Worker, and uses new Function rather than eval, so the sandbox can be controlled and secrets stay out of reach.",
      "Built to learn the idea rather than to ship a library.",
    ],
    tags: ["llm", "bun", "typescript", "long context", "learning"],
    aliases: ["rlmjs", "rlm", "recursive language model", "bun", "long context"],
    links: [
      { label: "GitHub", href: "https://github.com/nicolasmelo1/rlmjs" },
      { label: "The idea it came from", href: "https://www.k-a.in/RLM-py.html" },
    ],
  },
  {
    id: "flow",
    kind: "project",
    title: "Flow",
    summary:
      "An interpreted programming language written for Reflow's users, so they could automate their own work.",
    details: [
      "Pulled out of Reflow as its own thing after the company ended, for a project that never shipped.",
    ],
    period: "May 2021 to August 2021",
    tags: ["programming language", "interpreter", "dsl", "reflow"],
    aliases: ["flow", "programming language", "interpreter", "language i wrote", "dsl"],
  },
  {
    id: "skills",
    kind: "skills",
    title: "Themes / tools",
    summary: "The tools that show up again and again in the work.",
    details: [
      "Languages: TypeScript, JavaScript, Python, Rust, Elixir, HTML, CSS",
      "Frameworks: React, Vue.js, Next.js, NestJS, Express, Electron, Django, FastAPI, Flask, Expo and React Native",
      "Databases: PostgreSQL, MongoDB, Redis, SQLite, MySQL",
      "Libraries: TanStack Query, Axios, GraphQL, Tailwind, BullMQ, Turborepo, Styled-Components, Prisma, Drizzle, Sequelize, TypeORM, ESLint, tsup and SWC, nodemon, pm2, ioredis",
      "Testing: Jest, Vitest, Mocha, Cypress",
      "Runtimes: Node.js, Deno, Bun",
      "Cloud and ops: AWS (S3, EC2, EKS, ECS, Elastic Beanstalk, Route 53), Docker, Kubernetes, Pulumi, nginx, GitHub Actions, GitLab CI",
      "APIs worked with: OpenAI, Facebook Ads, Magento 2, Shopify",
      "Ways of working: Git, GitHub, GitLab, Jira, Linear",
      "Subjects: AI agents and LLM systems, event-driven backends, system and software architecture, reinforcement learning, developer tooling, local-first software",
    ],
    tags: ["skills", "stack", "languages", "tools", "frameworks", "databases", "cloud"],
    aliases: ["skills", "stack", "technologies", "languages", "tools", "frameworks", "databases"],
  },
  {
    id: "education",
    kind: "education",
    title: "Universidade de São Paulo",
    summary: "Two bachelor's degrees at USP, one in information systems and one in marketing.",
    details: [
      "Bachelor's degree, Management Information Systems (2013 to 2017). Coursework covered Java, C, iOS, Android, Maya, Photoshop and Illustrator.",
      "Bachelor's degree, Marketing (2017 to 2019).",
      "Marketing Director at the information systems student union, and marketing intern at its junior enterprise.",
    ],
    period: "2013 to 2019",
    location: "São Paulo, Brazil",
    tags: ["education", "usp", "information systems", "marketing", "university"],
    aliases: [
      "education",
      "studied",
      "study",
      "degree",
      "university",
      "college",
      "usp",
      "graduated",
      "school",
      "academic",
    ],
  },
  {
    id: "certifications",
    kind: "education",
    title: "Certifications",
    summary: "Two HackerRank basic skill certificates, both issued in July 2020.",
    details: ["Python (Basic), HackerRank.", "JavaScript (Basic), HackerRank."],
    period: "July 2020",
    tags: ["certifications", "hackerrank", "python", "javascript"],
    aliases: ["certifications", "certificates", "certified", "credentials", "hackerrank", "licenses"],
  },
  {
    id: "contact",
    kind: "contact",
    title: "Contact and links",
    summary: "How to reach him. Based in São Paulo, Brazil, and working remotely.",
    location: "São Paulo, Brazil",
    tags: ["contact", "github", "links", "linkedin", "email"],
    aliases: ["contact", "email", "links", "reach you", "linkedin", "hire me", "get in touch"],
    links: [
      { label: "nicolasmelo12@gmail.com", href: "mailto:nicolasmelo12@gmail.com" },
      { label: "GitHub", href: "https://github.com/nicolasmelo1" },
      { label: "LinkedIn", href: "https://www.linkedin.com/in/nicolas-melo" },
      { label: "Hugging Face", href: "https://huggingface.co/nicolasmelo" },
    ],
  },
];
