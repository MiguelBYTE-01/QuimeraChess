# ♞ Quimera Chess

> Uma extensão profissional para Google Chrome que roda o **Stockfish 16 NNUE** diretamente no seu navegador, exibindo setas com as melhores jogadas em tempo real em tabuleiros do Chess.com e Lichess.

---

## ✨ Funcionalidades

*   **Análise em Tempo Real:** Setas SVG desenhadas dinamicamente no tabuleiro enquanto você joga ou analisa, alimentadas pelo poderoso Stockfish 16 (NNUE/αβ · WebAssembly).
*   **Múltiplas Linhas (MultiPV):** Visualize até 5 lances candidatos simultaneamente, com setas codificadas por cores para indicar a ordem de preferência.
*   **Simulação de Rating (ELO):** Quer treinar contra um nível específico? Limite a força da engine de 1100 a 3600 ELO através do controle de *Skill Level*.
*   **Busca Configurável:** Escolha como a engine deve pensar: por Profundidade (Depth), Tempo (ms) ou quantidade de Nós calculados.
*   **Controle de Memória (Hash):** Ajuste fino da memória utilizada (de 2 a 32 MB) para equilibrar velocidade de inicialização e precisão em análises profundas.
*   **Otimizado para Bullet/Blitz:** Atualizações extremamente rápidas (debounce de 300ms) para não perder nenhum lance em partidas rápidas.
*   **Recuperação de Falhas:** Sistema automático que reinicia e retoma a análise caso a engine (WASM) sofra um crash, sem necessidade de recarregar a página.
*   **Atalho Rápido:** Pressione `Ctrl+Shift+A` (ou `Cmd+Shift+A` no Mac) para ligar/desligar a análise instantaneamente.

---

## 🚀 Como Instalar

Existem duas formas de instalar a extensão. Recomendamos usar o instalador automático (Opção 1) por ser muito mais fácil.

### Opção 1: Usando o Instalador Automático (.exe) - *Recomendado*
Esta é a maneira mais simples, pois o instalador já traz a extensão pronta, com os arquivos pesados do Stockfish incluídos.

1. Vá até a aba de **Releases** do projeto e baixe o instalador `.exe`.
2. Execute o instalador. Ele irá extrair a pasta completa da extensão para o seu computador.
3. Abra o navegador Google Chrome.
4. Na barra de endereços, digite `chrome://extensions/` e aperte Enter.
5. No canto superior direito, ative o **"Modo do desenvolvedor"** (Developer mode).
6. Clique no botão **"Carregar sem compactação"** (Load unpacked) que aparecerá no canto superior esquerdo.
7. Selecione a pasta que o instalador acabou de criar no seu computador.
8. Pronto! A extensão deve aparecer na sua lista de extensões com o ícone de xadrez.

### Opção 2: A partir do Código Fonte (Para desenvolvedores)
Como esta extensão utiliza o Stockfish compilado em WebAssembly (arquivos grandes), a instalação a partir do código fonte puro requer o download manual dos binários da engine.

**Passo 1: Obter o Código Fonte**
* Baixe ou clone este repositório para o seu computador.

**Passo 2: Baixar e Adicionar o Stockfish**
1. Vá até a aba de **Releases** deste repositório.
2. Baixe o arquivo compactado referente apenas à pasta do **Stockfish** (geralmente conterá os arquivos `.js`, `.wasm` e `.nnue`).
3. Descompacte este arquivo que você acabou de baixar.
4. Copie o conteúdo extraído para **dentro da pasta `stockfish`** do projeto que você baixou no Passo 1. (Se a pasta não existir dentro da extensão, basta criá-la e colar os arquivos dentro).

**Passo 3: Instalar no Chrome**
* Siga os mesmos passos 3 a 7 explicados na Opção 1 acima, selecionando a pasta do código fonte modificada.

---

## ♟️ Como Usar

1. Acesse o **Chess.com** ou **Lichess.org** e abra qualquer partida ou análise.
2. Clique no ícone da extensão no menu do Chrome para abrir o painel de configurações.
3. Ajuste as configurações desejadas (Lado a analisar, ELO, Tempo, Hash, etc.).
4. Clique no botão verde **"▶ Analyze"** ou use o atalho `Ctrl+Shift+A`.
5. Uma pequena insígnia preta aparecerá no canto inferior direito da tela mostrando o status do Stockfish e o melhor lance calculado.
6. As setas coloridas aparecerão automaticamente no tabuleiro indicando as melhores jogadas!

---

## ⚠️ Aviso Importante

**Esta extensão foi criada APENAS para propósitos de estudo, treino e análise pós-jogo.** 

Utilizar ferramentas de análise (engines de xadrez) durante **partidas oficiais/ranqueadas em tempo real contra outros jogadores é estritamente proibido** e viola os Termos de Serviço de plataformas como Chess.com e Lichess, resultando no banimento imediato da sua conta. Use com responsabilidade!
