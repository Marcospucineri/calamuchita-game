import { isTyping } from '../engine/Input';

export interface ChatHooks {
  /** Decide si se puede escribir ahora; si no, ya se ocupa de avisar por qué. */
  canOpen(): boolean;
  /** Algo tapa el juego (menú, mapa): la T no abre el chat. */
  blocked(): boolean;
  /** Devuelve un texto de error para mostrar, o null si salió bien. */
  send(text: string): Promise<string | null>;
  /** "Sala 2 · 5 jugadores" */
  info(): string;
  /** Todavía no puso nombre: la primera línea que escriba es su nombre. */
  needName(): boolean;
  setName(name: string): void;
}

export interface ChatEntry { name: string; text: string; mine: boolean }

const VISIBLE_MS = 14000;
const KEEP = 40;

/**
 * Chat de la sala: registro abajo a la izquierda (las últimas líneas se van apagando) y una
 * línea para escribir. La tecla T o el ícono sobre el menú la abren; Enter envía y Esc cancela.
 */
export class ChatUI {
  readonly root = document.createElement('section');
  private log = document.createElement('ol');
  private form = document.createElement('form');
  private input = document.createElement('input');
  private room = document.createElement('span');
  private button: HTMLButtonElement | null;
  private unread = 0;
  private naming = false;

  constructor(parent: HTMLElement, private hooks: ChatHooks) {
    this.root.className = 'chat';
    this.root.setAttribute('aria-label', 'Chat de la sala');
    this.log.className = 'chat-log';
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'polite');
    this.form.className = 'chat-form';
    this.form.hidden = true;
    this.input.type = 'text';
    this.input.maxLength = 120;
    this.input.placeholder = 'Escribí y apretá Enter';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.enterKeyHint = 'send';
    this.input.setAttribute('aria-label', 'Mensaje');
    this.room.className = 'chat-room';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'chat-send';
    submit.textContent = 'Enviar';
    this.form.append(this.room, this.input, submit);
    this.root.append(this.log, this.form);
    parent.appendChild(this.root);
    this.button = parent.querySelector<HTMLButtonElement>('.chat-btn');

    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });
    this.input.addEventListener('keydown', (e) => {
      // lo que se escribe acá no maneja el auto ni abre menús
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    // tocar fuera (por ejemplo para mirar alrededor) cierra la línea sin enviar
    this.input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== this.input) this.close(); }, 120));
    // en el celular el teclado tapa la parte de abajo: la línea de texto sube con él
    const vv = window.visualViewport;
    const syncKeyboard = () => this.root.style.setProperty('--kb', `${vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0}px`);
    vv?.addEventListener('resize', syncKeyboard);
    vv?.addEventListener('scroll', syncKeyboard);
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyT' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e) || this.hooks.blocked()) return;
      e.preventDefault();
      this.open();
    });
  }

  get isOpen(): boolean { return !this.form.hidden; }

  toggle(): void { if (this.isOpen) this.close(); else this.open(); }

  open(): void {
    if (this.isOpen || !this.hooks.canOpen()) return;
    this.root.classList.add('typing');
    this.form.hidden = false;
    this.room.textContent = this.hooks.info();
    this.input.value = '';
    this.naming = this.hooks.needName();
    this.input.placeholder = this.naming ? 'Poné tu nombre y apretá Enter' : 'Escribí y apretá Enter';
    this.input.maxLength = this.naming ? 24 : 120;
    this.unread = 0;
    this.button?.classList.remove('unread');
    this.button?.setAttribute('aria-pressed', 'true');
    this.input.focus({ preventScroll: true });
    this.log.scrollTop = this.log.scrollHeight;
  }

  close(): void {
    if (!this.isOpen) return;
    this.form.hidden = true;
    this.root.classList.remove('typing');
    this.button?.setAttribute('aria-pressed', 'false');
    if (document.activeElement === this.input) this.input.blur();
  }

  private submit(): void {
    const text = this.input.value.trim();
    const naming = this.naming;
    this.close();
    if (!text) return;
    if (naming) {
      this.hooks.setName(text);
      this.system(`Listo, ${text.slice(0, 24)}. Ya podés chatear.`);
      this.open();
      return;
    }
    void this.hooks.send(text).then((error) => { if (error) this.system(error); });
  }

  add(entry: ChatEntry): void {
    const li = document.createElement('li');
    li.className = 'chat-line' + (entry.mine ? ' mine' : '');
    const who = document.createElement('b');
    who.textContent = entry.name;
    const body = document.createElement('span');
    body.textContent = entry.text;
    li.append(who, ' ', body);
    this.push(li);
    if (!entry.mine && !this.isOpen) {
      this.unread++;
      this.button?.classList.add('unread');
    }
  }

  system(text: string): void {
    const li = document.createElement('li');
    li.className = 'chat-line system';
    li.textContent = text;
    this.push(li);
  }

  private push(li: HTMLElement): void {
    this.log.appendChild(li);
    while (this.log.children.length > KEEP) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
    setTimeout(() => li.classList.add('old'), VISIBLE_MS);
  }

  /** Cantidad de otros jugadores en la sala, sobre el ícono. */
  setOthers(n: number | null): void {
    if (!this.button) return;
    const badge = this.button.querySelector<HTMLElement>('.badge');
    this.button.classList.toggle('connected', n !== null);
    if (badge) { badge.hidden = n === null; badge.querySelector('b')!.textContent = String(n ?? 0); }
    this.button.title = n === null ? 'Chat (T)' : `Chat (T) · ${n} ${n === 1 ? 'jugador más' : 'jugadores más'} en la sala`;
  }
}
