document.addEventListener('DOMContentLoaded', () => {
    // ========================================================================
    // 1. CONFIGURAÇÃO INICIAL E ESTADO DA APLICAÇÃO
    // ========================================================================

    // IMPORTANTE: Verifique se esta URL corresponde exatamente à URL do seu backend no Render.
    const API_URL = 'https://salc.onrender.com';

    let currentUser = null; // Armazenará { username, role, ... }
    
    // Cache de dados para evitar requisições repetidas e manter o estado da UI
    let appState = {
        secoes: [],
        notasCredito: { total: 0, page: 1, size: 10, results: [] },
        empenhos: { total: 0, page: 1, size: 10, results: [] },
        users: [],
        auditLogs: [],
        currentFilters: {}, // Guarda os filtros aplicados para preservar o estado
    };

    // Referências aos elementos principais do DOM
    const appNav = document.getElementById('app-nav');
    const appMain = document.getElementById('app-main');
    const usernameDisplay = document.getElementById('username-display');
    const logoutBtn = document.getElementById('logout-btn');
    const modalContainer = document.getElementById('modal-container');
    const modalTemplate = document.getElementById('modal-template');

    // ========================================================================
    // 2. INICIALIZAÇÃO E AUTENTICAÇÃO
    // ========================================================================

    /**
     * Função principal que inicia a aplicação. Verifica a sessão através do cookie,
     * busca os dados do utilizador e renderiza o layout inicial.
     */
    async function initApp() {
        try {
            // A autenticação agora depende do cookie HttpOnly enviado automaticamente
            currentUser = await fetchWithAuth('/users/me');
            renderLayout();
            navigateTo('dashboard'); // A view inicial é o Dashboard
        } catch (error) {
            // Se a requisição falhar (ex: cookie expirado/inválido), redireciona para o login
            window.location.href = 'login.html';
        }
    }

    /**
     * Envia um pedido de logout ao backend para invalidar o cookie e redireciona.
     */
    async function logout() {
        try {
            await fetchWithAuth('/logout', { method: 'POST' });
        } catch (error) {
            console.error("Erro no pedido de logout, mas a redirecionar mesmo assim:", error);
        } finally {
            window.location.href = 'login.html';
        }
    }

    // ========================================================================
    // 3. FUNÇÃO AUXILIAR PARA REQUISIÇÕES À API
    // ========================================================================

    /**
     * Wrapper para a função fetch que trata da autenticação via cookies,
     * define os cabeçalhos padrão e lida com erros comuns.
     * @param {string} endpoint - O endpoint da API (ex: '/users/me').
     * @param {object} options - Opções padrão da função fetch (method, body, etc.).
     * @returns {Promise<any>} - A resposta JSON da API.
     */
    async function fetchWithAuth(endpoint, options = {}) {
        const defaultOptions = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            // ESSENCIAL: Permite que o navegador envie cookies para a API em domínios diferentes.
            credentials: 'include',
        };

        const mergedOptions = {
            ...defaultOptions,
            ...options,
            headers: { ...defaultOptions.headers, ...options.headers },
        };

        try {
            const response = await fetch(`${API_URL}${endpoint}`, mergedOptions);

            if (response.status === 401) { // Não autorizado (cookie inválido/expirado)
                window.location.href = 'login.html';
                throw new Error('Sessão expirada. Por favor, faça login novamente.');
            }

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(errorData.detail || 'Ocorreu um erro na requisição.');
            }
            
            if (options.responseType === 'blob') {
                return response.blob();
            }

            // Para respostas sem conteúdo (ex: DELETE), retorna null
            return response.status === 204 ? null : response.json();

        } catch (error) {
            // Re-lança o erro para que a função que chamou possa tratá-lo
            throw error;
        }
    }

    // ========================================================================
    // 4. LÓGICA DE MODAIS E NOTIFICAÇÕES
    // ========================================================================

    /**
     * Abre um modal genérico na tela.
     * @param {string} title - O título do modal.
     * @param {string} contentHTML - O HTML para o corpo do modal.
     * @param {function} onOpen - (Opcional) Callback a ser executado após o modal ser aberto.
     */
    function openModal(title, contentHTML, onOpen) {
        const modalClone = modalTemplate.content.cloneNode(true);
        const modalBackdrop = modalClone.querySelector('.modal-backdrop');
        const modalElement = modalClone.querySelector('.modal');
        
        modalClone.querySelector('.modal-title').textContent = title;
        modalClone.querySelector('.modal-body').innerHTML = contentHTML;
        
        modalContainer.innerHTML = ''; // Limpa modais anteriores
        modalContainer.appendChild(modalClone);
        
        // Adiciona um pequeno atraso para a transição de CSS funcionar
        setTimeout(() => modalContainer.classList.add('active'), 10);

        const closeModalFunc = () => {
            modalContainer.classList.remove('active');
            // Remove o elemento da DOM após a transição
            setTimeout(() => {
                modalContainer.innerHTML = '';
            }, 300); // O tempo deve corresponder à duração da transição no CSS
        };
        
        modalBackdrop.addEventListener('click', (e) => { if (e.target === modalBackdrop) closeModalFunc(); });
        modalElement.querySelector('.modal-close-btn').addEventListener('click', closeModalFunc);

        if (onOpen) onOpen(modalElement, closeModalFunc);
    }
    
    /**
     * Mostra um modal de confirmação padronizado.
     * @param {string} title - O título da confirmação (ex: "Excluir Utilizador").
     * @param {string} message - A pergunta de confirmação (ex: "Tem a certeza...?").
     * @param {function} onConfirm - A função a ser executada se o utilizador confirmar.
     */
    function showConfirmationModal(title, message, onConfirm) {
        const contentHTML = `
            <p>${message}</p>
            <div class="form-actions" style="justify-content: flex-end; display: flex; gap: 1rem;">
                <button id="confirm-cancel-btn" class="btn">Cancelar</button>
                <button id="confirm-action-btn" class="btn btn-primary">Confirmar</button>
            </div>
        `;
        openModal(title, contentHTML, (modalElement, closeModalFunc) => {
            modalElement.querySelector('#confirm-action-btn').addEventListener('click', () => {
                onConfirm();
                closeModalFunc();
            });
            modalElement.querySelector('#confirm-cancel-btn').addEventListener('click', closeModalFunc);
        });
    }

// ========================================================================
    // 5. RENDERIZAÇÃO DO LAYOUT E NAVEGAÇÃO
    // ========================================================================

    /**
     * Renderiza os componentes estáticos do layout, como o cabeçalho e as abas de navegação.
     */
    function renderLayout() {
        usernameDisplay.textContent = `Utilizador: ${currentUser.username} (${currentUser.role})`;
        logoutBtn.addEventListener('click', logout);
        
        let navHTML = `
            <button class="tab-btn active" data-view="dashboard">Dashboard</button>
            <button class="tab-btn" data-view="notasCredito">Notas de Crédito</button>
            <button class="tab-btn" data-view="empenhos">Empenhos</button>
        `;
        if (currentUser.role === 'ADMINISTRADOR') {
            navHTML += `<button class="tab-btn" data-view="admin">Administração</button>`;
        }
        appNav.innerHTML = navHTML;

        appNav.addEventListener('click', (e) => {
            if (e.target.matches('.tab-btn')) {
                // Remove a classe 'active' de todas as abas
                appNav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                // Adiciona a classe 'active' à aba clicada
                e.target.classList.add('active');
                navigateTo(e.target.dataset.view);
            }
        });
    }

    /**
     * Roteador principal da aplicação. Limpa o conteúdo principal e renderiza a view solicitada.
     * @param {string} view - O nome da view a ser renderizada (ex: 'dashboard').
     * @param {object} params - Parâmetros opcionais a serem passados para a view.
     */
    async function navigateTo(view, params = {}) {
        appMain.innerHTML = `<div class="loading-spinner"><p>A carregar...</p></div>`;
        try {
            switch (view) {
                case 'dashboard':
                    await renderDashboardView(appMain);
                    break;
                case 'notasCredito':
                    // Inicia na primeira página ao navegar para a view
                    await renderNotasCreditoView(appMain, 1); 
                    break;
                case 'empenhos':
                    await renderEmpenhosView(appMain, 1);
                    break;
                case 'admin':
                    await renderAdminView(appMain);
                    break;
                default:
                    appMain.innerHTML = `<h1>Página não encontrada</h1>`;
            }
        } catch (error) {
            appMain.innerHTML = `<div class="card error-message">
                <h3>Erro ao carregar a página</h3>
                <p>${error.message}</p>
            </div>`;
        }
    }

    /**
     * Função auxiliar para renderizar os controlos de paginação.
     * @param {HTMLElement} container - O elemento onde os controlos serão inseridos.
     * @param {number} totalItems - O número total de registos.
     * @param {number} currentPage - A página atual.
     * @param {number} pageSize - O número de itens por página.
     * @param {function} onPageChange - A função a ser chamada quando o utilizador muda de página.
     */
    function renderPagination(container, totalItems, currentPage, pageSize, onPageChange) {
        if (totalItems <= pageSize) {
            container.innerHTML = '';
            return;
        }

        const totalPages = Math.ceil(totalItems / pageSize);
        const startItem = (currentPage - 1) * pageSize + 1;
        const endItem = Math.min(currentPage * pageSize, totalItems);

        container.innerHTML = `
            <div class="pagination">
                <button id="prev-page-btn" class="btn" ${currentPage === 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-left"></i> Anterior
                </button>
                <span class="pagination-info">
                    A exibir ${startItem}–${endItem} de ${totalItems}
                </span>
                <button id="next-page-btn" class="btn" ${currentPage === totalPages ? 'disabled' : ''}>
                    Próxima <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;

        const prevBtn = container.querySelector('#prev-page-btn');
        const nextBtn = container.querySelector('#next-page-btn');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => onPageChange(currentPage - 1));
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => onPageChange(currentPage + 1));
        }
    }

// ========================================================================
    // 6. LÓGICA DAS VIEWS
    // ========================================================================

    /**
     * Renderiza a view principal do Dashboard.
     * @param {HTMLElement} container - O elemento <main> onde a view será renderizada.
     */
    async function renderDashboardView(container) {
        // Popula o cache de seções se estiver vazio
        if (appState.secoes.length === 0) {
            try {
                appState.secoes = await fetchWithAuth('/secoes');
            } catch (error) {
                console.error("Erro ao carregar seções para o dashboard:", error);
            }
        }

        container.innerHTML = `
            <div class="view-header">
                <h1>Dashboard</h1>
            </div>
            <div class="dashboard-grid">
                <div class="card kpi-card">
                    <h3>Saldo Disponível Total</h3>
                    <p id="kpi-saldo-total">A carregar...</p>
                </div>
                <div class="card kpi-card">
                    <h3>Total Empenhado</h3>
                    <p id="kpi-valor-empenhado">A carregar...</p>
                </div>
                <div class="card kpi-card">
                    <h3>NCs Ativas</h3>
                    <p id="kpi-ncs-ativas">A carregar...</p>
                </div>
            </div>
            <div class="card aviso-card">
                <h3><i class="fas fa-exclamation-triangle"></i> Avisos Importantes (Próximos 7 dias)</h3>
                <div id="aviso-content" class="aviso-content">A carregar...</div>
            </div>
            <div class="card">
                <div class="view-header">
                    <h3>Gerar Relatório em PDF</h3>
                    <button id="generate-report-btn" class="btn btn-primary"><i class="fas fa-file-pdf"></i> Gerar Relatório</button>
                </div>
                <div class="filters">
                    <div class="filter-group">
                        <label for="report-filter-pi">Plano Interno</label>
                        <input type="text" id="report-filter-pi" placeholder="Opcional">
                    </div>
                    <div class="filter-group">
                        <label for="report-filter-nd">Natureza de Despesa</label>
                        <input type="text" id="report-filter-nd" placeholder="Opcional">
                    </div>
                    <div class="filter-group">
                        <label for="report-filter-secao">Seção Responsável</label>
                        <select id="report-filter-secao"><option value="">Todas</option></select>
                    </div>
                    <div class="filter-group">
                        <label for="report-filter-status">Status</label>
                        <select id="report-filter-status">
                            <option value="">Todos</option>
                            <option value="Ativa">Ativa</option>
                            <option value="Totalmente Empenhada">Totalmente Empenhada</option>
                        </select>
                    </div>
                </div>
            </div>
        `;
        
        // Popula o seletor de seções para o relatório
        const secaoSelect = container.querySelector('#report-filter-secao');
        if (secaoSelect) {
            secaoSelect.innerHTML = '<option value="">Todas</option>' + appState.secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
        }

        // Adiciona o listener para o botão de gerar relatório
        container.querySelector('#generate-report-btn').addEventListener('click', generateReport);
        
        // Carrega os dados do dashboard
        loadDashboardData();
    }
    
    /**
     * Busca e exibe os dados dos KPIs e avisos no Dashboard.
     */
    async function loadDashboardData() {
        try {
            // Busca todos os dados do dashboard em paralelo para otimizar o carregamento
            const [kpis, avisos] = await Promise.all([
                fetchWithAuth('/dashboard/kpis'),
                fetchWithAuth('/dashboard/avisos')
            ]);

            // Atualiza os KPIs
            document.getElementById('kpi-saldo-total').textContent = kpis.saldo_disponivel_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            document.getElementById('kpi-valor-empenhado').textContent = kpis.valor_empenhado_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            document.getElementById('kpi-ncs-ativas').textContent = kpis.ncs_ativas;

            // Atualiza os avisos
            const avisoContainer = document.getElementById('aviso-content');
            if (avisos.length > 0) {
                avisoContainer.innerHTML = avisos.map(nc => {
                    const prazo = new Date(nc.prazo_empenho + 'T00:00:00'); // Adiciona T00:00:00 para evitar problemas de fuso horário
                    const hoje = new Date();
                    hoje.setHours(0, 0, 0, 0);
                    const diffTime = prazo - hoje;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    
                    let avisoTexto;
                    if (diffDays > 1) {
                        avisoTexto = `Vence em ${diffDays} dias (${prazo.toLocaleDateString('pt-BR')})`;
                    } else if (diffDays === 1) {
                        avisoTexto = `Vence amanhã (${prazo.toLocaleDateString('pt-BR')})!`;
                    } else if (diffDays === 0) {
                        avisoTexto = `Vence hoje (${prazo.toLocaleDateString('pt-BR')})!`;
                    } else {
                         avisoTexto = `Venceu há ${Math.abs(diffDays)} dia(s) (${prazo.toLocaleDateString('pt-BR')})!`;
                    }

                    return `<div class="aviso-item"><strong>NC ${nc.numero_nc}:</strong> ${avisoTexto}</div>`;
                }).join('');
            } else {
                avisoContainer.innerHTML = '<p>Nenhum aviso no momento.</p>';
            }

        } catch (error) {
            console.error("Erro ao carregar dados do dashboard:", error);
            document.getElementById('kpi-saldo-total').textContent = 'Erro';
            document.getElementById('kpi-valor-empenhado').textContent = 'Erro';
            document.getElementById('kpi-ncs-ativas').textContent = 'Erro';
            document.getElementById('aviso-content').innerHTML = `<p class="error-message">Não foi possível carregar os avisos.</p>`;
        }
    }

    /**
     * Coleta os filtros, chama o endpoint de relatório e inicia o download do PDF.
     */
    async function generateReport() {
        const btn = document.getElementById('generate-report-btn');
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A gerar...`;

        const filters = {
            plano_interno: document.getElementById('report-filter-pi').value || undefined,
            nd: document.getElementById('report-filter-nd').value || undefined,
            secao_responsavel_id: document.getElementById('report-filter-secao').value || undefined,
            status: document.getElementById('report-filter-status').value || undefined,
        };

        // Remove chaves com valores undefined para não sujar a URL
        Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);

        const params = new URLSearchParams(filters).toString();

        try {
            const blob = await fetchWithAuth(`/relatorios/pdf?${params}`, { responseType: 'blob' });
            
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'relatorio_salc.pdf';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();

        } catch (error) {
            openModal('Erro ao Gerar Relatório', `<p>${error.message}</p>`);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-file-pdf"></i> Gerar Relatório`;
        }
    }

/**
     * Renderiza a view de Gestão de Notas de Crédito.
     * @param {HTMLElement} container - O elemento <main> onde a view será renderizada.
     * @param {number} page - O número da página a ser carregada.
     */
    async function renderNotasCreditoView(container, page) {
        container.innerHTML = `
            <div class="view-header">
                <h1>Gestão de Notas de Crédito</h1>
                <button id="add-nc-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Adicionar Nova NC</button>
            </div>
            <div class="filters card">
                <div class="filter-group">
                    <label for="filter-pi">Plano Interno</label>
                    <input type="text" id="filter-pi" placeholder="Filtrar por PI">
                </div>
                <div class="filter-group">
                    <label for="filter-nd">Natureza de Despesa</label>
                    <input type="text" id="filter-nd" placeholder="Filtrar por ND">
                </div>
                <div class="filter-group">
                    <label for="filter-secao">Seção Responsável</label>
                    <select id="filter-secao"><option value="">Todas</option></select>
                </div>
                <div class="filter-group">
                    <label for="filter-status">Status</label>
                    <select id="filter-status">
                        <option value="">Todos</option>
                        <option value="Ativa">Ativa</option>
                        <option value="Totalmente Empenhada">Totalmente Empenhada</option>
                    </select>
                </div>
                <button id="apply-filters-btn" class="btn">Aplicar Filtros</button>
            </div>
            <div class="table-container card">
                <table id="nc-table">
                    <thead>
                        <tr>
                            <th>Nº da NC</th>
                            <th>Plano Interno</th>
                            <th>ND</th>
                            <th>Seção</th>
                            <th>Valor Original</th>
                            <th>Saldo Disponível</th>
                            <th>Prazo</th>
                            <th>Status</th>
                            <th class="actions">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td colspan="9" style="text-align:center;">A carregar dados...</td></tr>
                    </tbody>
                </table>
            </div>
            <div id="nc-pagination-container"></div>
        `;

        // Popula o seletor de seções
        const secaoSelect = container.querySelector('#filter-secao');
        if (appState.secoes.length > 0) {
            secaoSelect.innerHTML = '<option value="">Todas</option>' + appState.secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
        }
        
        // Aplica os filtros guardados na UI
        container.querySelector('#filter-pi').value = appState.currentFilters.plano_interno || '';
        container.querySelector('#filter-nd').value = appState.currentFilters.nd || '';
        container.querySelector('#filter-secao').value = appState.currentFilters.secao_responsavel_id || '';
        container.querySelector('#filter-status').value = appState.currentFilters.status || '';

        // Carrega a tabela com a página solicitada
        await loadNotasCreditoTable(page);

        // Adiciona os listeners de eventos
        container.querySelector('#apply-filters-btn').addEventListener('click', () => {
            // Guarda os filtros no estado da aplicação
            appState.currentFilters = {
                plano_interno: container.querySelector('#filter-pi').value,
                nd: container.querySelector('#filter-nd').value,
                secao_responsavel_id: container.querySelector('#filter-secao').value,
                status: container.querySelector('#filter-status').value,
            };
            loadNotasCreditoTable(1); // Sempre volta para a primeira página ao aplicar filtros
        });

        container.querySelector('#add-nc-btn').addEventListener('click', () => {
            const formHTML = getNotaCreditoFormHTML();
            openModal('Adicionar Nova Nota de Crédito', formHTML, (modalElement, closeModalFunc) => {
                modalElement.querySelector('#nc-form').addEventListener('submit', (e) => handleNcFormSubmit(e, closeModalFunc));
            });
        });
    }

    /**
     * Carrega os dados das Notas de Crédito da API e renderiza a tabela e a paginação.
     * @param {number} page - O número da página a ser carregada.
     */
    async function loadNotasCreditoTable(page = 1) {
        const tableBody = document.querySelector('#nc-table tbody');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;">A buscar dados...</td></tr>`;

        try {
            const params = new URLSearchParams({
                page: page,
                size: appState.notasCredito.size,
                ...appState.currentFilters
            });
            
            const data = await fetchWithAuth(`/notas-credito?${params.toString()}`);
            appState.notasCredito = data;

            if (data.results.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;">Nenhuma Nota de Crédito encontrada.</td></tr>`;
                document.getElementById('nc-pagination-container').innerHTML = '';
                return;
            }

            tableBody.innerHTML = data.results.map(nc => `
                <tr data-id="${nc.id}">
                    <td>${nc.numero_nc}</td>
                    <td>${nc.plano_interno}</td>
                    <td>${nc.nd}</td>
                    <td>${nc.secao_responsavel.nome}</td>
                    <td>${nc.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${nc.saldo_disponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(nc.prazo_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td><span class="status status-${nc.status.toLowerCase().replace(/ /g, '-')}">${nc.status}</span></td>
                    <td class="actions">
                        <button class="btn-icon" data-action="edit-nc" data-id="${nc.id}" title="Editar NC"><i class="fas fa-edit"></i></button>
                        ${currentUser.role === 'ADMINISTRADOR' ? 
                            `<button class="btn-icon btn-delete" data-action="delete-nc" data-id="${nc.id}" data-numero="${nc.numero_nc}" title="Excluir NC"><i class="fas fa-trash"></i></button>` : ''}
                    </td>
                </tr>
            `).join('');

            const paginationContainer = document.getElementById('nc-pagination-container');
            renderPagination(paginationContainer, data.total, data.page, data.size, (newPage) => {
                // Ao mudar de página, a view inteira é recarregada para manter a simplicidade
                navigateTo('notasCredito', { page: newPage });
            });

        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="9" class="error-message">Erro ao carregar dados: ${error.message}</td></tr>`;
        }
    }

    /**
     * Gera o HTML para o formulário de Nota de Crédito.
     * @param {object} nc - (Opcional) Objeto NC para preencher o formulário para edição.
     * @returns {string} HTML do formulário.
     */
    function getNotaCreditoFormHTML(nc = {}) {
        const isEditing = !!nc.id;
        const secoesOptions = appState.secoes.map(s => 
            `<option value="${s.id}" ${s.id === nc.secao_responsavel_id ? 'selected' : ''}>${s.nome}</option>`
        ).join('');

        return `
            <form id="nc-form" data-id="${isEditing ? nc.id : ''}" novalidate>
                <div class="form-grid">
                    <div class="form-field"><label for="numero_nc">Número da NC</label><input type="text" name="numero_nc" value="${nc.numero_nc || ''}" required></div>
                    <div class="form-field"><label for="valor">Valor (R$)</label><input type="number" name="valor" step="0.01" value="${nc.valor || ''}" required min="0.01"></div>
                    <div class="form-field"><label for="secao_responsavel_id">Seção Responsável</label><select name="secao_responsavel_id" required>${secoesOptions}</select></div>
                    <div class="form-field"><label for="plano_interno">Plano Interno</label><input type="text" name="plano_interno" value="${nc.plano_interno || ''}" required></div>
                    <div class="form-field"><label for="nd">Natureza de Despesa</label><input type="text" name="nd" value="${nc.nd || ''}" required pattern="\\d{6}" title="Deve conter 6 dígitos numéricos."></div>
                    <div class="form-field"><label for="ptres">PTRES</label><input type="text" name="ptres" value="${nc.ptres || ''}" required maxlength="6"></div>
                    <div class="form-field"><label for="fonte">Fonte</label><input type="text" name="fonte" value="${nc.fonte || ''}" required maxlength="10"></div>
                    <div class="form-field"><label for="esfera">Esfera</label><input type="text" name="esfera" value="${nc.esfera || ''}" required></div>
                    <div class="form-field"><label for="data_chegada">Data de Chegada</label><input type="date" name="data_chegada" value="${nc.data_chegada || ''}" required></div>
                    <div class="form-field"><label for="prazo_empenho">Prazo para Empenho</label><input type="date" name="prazo_empenho" value="${nc.prazo_empenho || ''}" required></div>
                    <div class="form-field form-field-full"><label for="descricao">Descrição</label><textarea name="descricao">${nc.descricao || ''}</textarea></div>
                </div>
                <div id="form-feedback" class="modal-feedback" style="display: none;"></div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">${isEditing ? 'Salvar Alterações' : 'Criar Nota de Crédito'}</button>
                </div>
            </form>
        `;
    }

/**
     * Manipula a submissão de um formulário de NC (criação ou edição).
     * @param {Event} e - O evento de submissão do formulário.
     * @param {function} closeModalFunc - A função para fechar o modal.
     */
    async function handleNcFormSubmit(e, closeModalFunc) {
        e.preventDefault();
        const form = e.target;
        const submitButton = form.querySelector('button[type="submit"]');
        const feedbackContainer = form.querySelector('#form-feedback');

        // Validação de frontend básica
        if (!form.checkValidity()) {
            feedbackContainer.textContent = 'Por favor, preencha todos os campos obrigatórios corretamente.';
            feedbackContainer.style.display = 'block';
            return;
        }
        
        const dataChegada = form.elements.data_chegada.value;
        const prazoEmpenho = form.elements.prazo_empenho.value;
        if (prazoEmpenho < dataChegada) {
            feedbackContainer.textContent = 'O prazo para empenho não pode ser anterior à data de chegada.';
            feedbackContainer.style.display = 'block';
            return;
        }

        submitButton.disabled = true;
        submitButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A salvar...`;
        feedbackContainer.style.display = 'none';

        const id = form.dataset.id;
        const method = id ? 'PUT' : 'POST';
        const endpoint = id ? `/notas-credito/${id}` : '/notas-credito';

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        data.valor = parseFloat(data.valor);
        data.secao_responsavel_id = parseInt(data.secao_responsavel_id);

        try {
            await fetchWithAuth(endpoint, { method, body: JSON.stringify(data) });
            closeModalFunc();
            // Recarrega a view na página atual para mostrar os dados atualizados
            await loadNotasCreditoTable(appState.notasCredito.page);
        } catch (error) {
            feedbackContainer.textContent = `Erro ao salvar: ${error.message}`;
            feedbackContainer.style.display = 'block';
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = id ? 'Salvar Alterações' : 'Criar Nota de Crédito';
        }
    }

    // ========================================================================
    // 7. MANIPULADOR DE EVENTOS GLOBAIS (Event Handlers)
    // ========================================================================

    // Usamos "event delegation" no container <main> para lidar com cliques em botões
    // que são adicionados dinamicamente, como os de editar e excluir.
    appMain.addEventListener('click', async (e) => {
        const targetButton = e.target.closest('button.btn-icon');
        if (!targetButton) return;

        const { action, id } = targetButton.dataset;

        // --- Ações da View de Notas de Crédito ---
        if (action === 'edit-nc') {
            try {
                const ncData = await fetchWithAuth(`/notas-credito/${id}`);
                const formHTML = getNotaCreditoFormHTML(ncData);
                openModal(`Editar Nota de Crédito: ${ncData.numero_nc}`, formHTML, (modalElement, closeModalFunc) => {
                    modalElement.querySelector('#nc-form').addEventListener('submit', (event) => handleNcFormSubmit(event, closeModalFunc));
                });
            } catch (error) {
                openModal('Erro', `<p>Não foi possível carregar os dados da NC: ${error.message}</p>`);
            }
        }
        
        if (action === 'delete-nc') {
            const numeroNc = targetButton.dataset.numero;
            showConfirmationModal(
                'Excluir Nota de Crédito',
                `Tem a certeza de que deseja excluir a Nota de Crédito "${numeroNc}"? Esta ação não pode ser desfeita.`,
                async () => {
                    try {
                        await fetchWithAuth(`/notas-credito/${id}`, { method: 'DELETE' });
                        // Recarrega a tabela na página atual
                        await loadNotasCreditoTable(appState.notasCredito.page);
                    } catch (error) {
                        openModal('Erro ao Excluir', `<p>${error.message}</p>`);
                    }
                }
            );
        }
    });

// ========================================================================
    // 8. LÓGICA DAS VIEWS RESTANTES
    // ========================================================================

    /**
     * Renderiza a view de Gestão de Empenhos.
     * @param {HTMLElement} container - O elemento <main> onde a view será renderizada.
     * @param {number} page - O número da página a ser carregada.
     */
    async function renderEmpenhosView(container, page) {
        container.innerHTML = `
            <div class="view-header">
                <h1>Gestão de Empenhos</h1>
                <button id="add-empenho-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Novo Empenho</button>
            </div>
            <div class="table-container card">
                <table id="empenhos-table">
                    <thead>
                        <tr>
                            <th>Nº do Empenho</th>
                            <th>Nº da NC Associada</th>
                            <th>Seção Requisitante</th>
                            <th>Valor</th>
                            <th>Data</th>
                            <th class="actions">Ações</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
            <div id="empenhos-pagination-container"></div>
        `;

        await loadEmpenhosTable(page);

        container.querySelector('#add-empenho-btn').addEventListener('click', async () => {
            // Garante que temos as NCs e Seções mais recentes antes de abrir o formulário
            try {
                const [notas, secoes] = await Promise.all([
                    fetchWithAuth('/notas-credito?size=1000'), // Pega uma lista grande para o seletor
                    fetchWithAuth('/secoes')
                ]);
                const formHTML = getEmpenhoFormHTML(null, notas.results, secoes);
                openModal('Novo Empenho', formHTML, (modalElement, closeModalFunc) => {
                    modalElement.querySelector('#empenho-form').addEventListener('submit', (e) => handleEmpenhoFormSubmit(e, closeModalFunc));
                });
            } catch (error) {
                openModal('Erro', `<p>Não foi possível carregar os dados para o formulário: ${error.message}</p>`);
            }
        });
    }

    /**
     * Carrega os dados dos Empenhos da API e renderiza a tabela e a paginação.
     * @param {number} page - O número da página a ser carregada.
     */
    async function loadEmpenhosTable(page = 1) {
        const tableBody = document.querySelector('#empenhos-table tbody');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">A buscar dados...</td></tr>`;

        try {
            const params = new URLSearchParams({ page, size: appState.empenhos.size });
            const data = await fetchWithAuth(`/empenhos?${params.toString()}`);
            appState.empenhos = data;

            if (data.results.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Nenhum empenho encontrado.</td></tr>`;
                document.getElementById('empenhos-pagination-container').innerHTML = '';
                return;
            }

            // Para exibir o número da NC, precisamos de um mapa ou de buscar os dados completos
            // A API agora retorna os dados da NC, então podemos usá-los diretamente
            tableBody.innerHTML = data.results.map(e => `
                <tr data-id="${e.id}">
                    <td>${e.numero_ne}</td>
                    <td>${e.nota_credito.numero_nc}</td>
                    <td>${e.secao_requisitante.nome}</td>
                    <td>${e.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(e.data_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td class="actions">
                        ${currentUser.role === 'ADMINISTRADOR' ?
                            `<button class="btn-icon btn-delete" data-action="delete-empenho" data-id="${e.id}" data-numero="${e.numero_ne}" title="Excluir Empenho"><i class="fas fa-trash"></i></button>` : 'N/A'}
                    </td>
                </tr>
            `).join('');

            const paginationContainer = document.getElementById('empenhos-pagination-container');
            renderPagination(paginationContainer, data.total, data.page, data.size, (newPage) => {
                navigateTo('empenhos', { page: newPage });
            });

        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="6" class="error-message">Erro ao carregar empenhos: ${error.message}</td></tr>`;
        }
    }

    /**
     * Gera o HTML para o formulário de Empenho.
     * @param {object} empenho - (Opcional) Objeto Empenho para edição.
     * @param {Array} notasCredito - Lista de NCs para o seletor.
     * @param {Array} secoes - Lista de Seções para o seletor.
     * @returns {string} HTML do formulário.
     */
    function getEmpenhoFormHTML(empenho = {}, notasCredito, secoes) {
        const isEditing = !!empenho.id;
        const notasOptions = notasCredito.filter(nc => nc.status === 'Ativa').map(nc =>
            `<option value="${nc.id}" ${nc.id === empenho.nota_credito_id ? 'selected' : ''}>${nc.numero_nc} (Saldo: ${nc.saldo_disponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})</option>`
        ).join('');
        const secoesOptions = secoes.map(s =>
            `<option value="${s.id}" ${s.id === empenho.secao_requisitante_id ? 'selected' : ''}>${s.nome}</option>`
        ).join('');

        return `
            <form id="empenho-form" data-id="${isEditing ? empenho.id : ''}" novalidate>
                <div class="form-grid">
                    <div class="form-field"><label for="numero_ne">Número do Empenho (NE)</label><input type="text" name="numero_ne" value="${empenho.numero_ne || ''}" required></div>
                    <div class="form-field"><label for="valor">Valor (R$)</label><input type="number" name="valor" step="0.01" min="0.01" value="${empenho.valor || ''}" required></div>
                    <div class="form-field"><label for="data_empenho">Data do Empenho</label><input type="date" name="data_empenho" value="${empenho.data_empenho || ''}" required></div>
                    <div class="form-field"><label for="nota_credito_id">Nota de Crédito Associada</label><select name="nota_credito_id" required>${notasOptions}</select></div>
                    <div class="form-field"><label for="secao_requisitante_id">Seção Requisitante</label><select name="secao_requisitante_id" required>${secoesOptions}</select></div>
                    <div class="form-field form-field-full"><label for="observacao">Observação</label><textarea name="observacao">${empenho.observacao || ''}</textarea></div>
                </div>
                <div id="form-feedback" class="modal-feedback" style="display: none;"></div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">${isEditing ? 'Salvar Alterações' : 'Criar Empenho'}</button>
                </div>
            </form>
        `;
    }

    /**
     * Manipula a submissão do formulário de Empenho.
     * @param {Event} e - O evento de submissão.
     * @param {function} closeModalFunc - A função para fechar o modal.
     */
    async function handleEmpenhoFormSubmit(e, closeModalFunc) {
        e.preventDefault();
        const form = e.target;
        const submitButton = form.querySelector('button[type="submit"]');
        const feedbackContainer = form.querySelector('#form-feedback');

        if (!form.checkValidity()) {
            feedbackContainer.textContent = 'Por favor, preencha todos os campos obrigatórios.';
            feedbackContainer.style.display = 'block';
            return;
        }

        submitButton.disabled = true;
        submitButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A salvar...`;
        feedbackContainer.style.display = 'none';

        const id = form.dataset.id;
        const method = id ? 'PUT' : 'POST';
        const endpoint = id ? `/empenhos/${id}` : '/empenhos';

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        data.valor = parseFloat(data.valor);
        data.nota_credito_id = parseInt(data.nota_credito_id);
        data.secao_requisitante_id = parseInt(data.secao_requisitante_id);

        try {
            await fetchWithAuth(endpoint, { method, body: JSON.stringify(data) });
            closeModalFunc();
            await loadEmpenhosTable(appState.empenhos.page);
        } catch (error) {
            feedbackContainer.textContent = `Erro ao salvar: ${error.message}`;
            feedbackContainer.style.display = 'block';
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = id ? 'Salvar Alterações' : 'Criar Empenho';
        }
    }

/**
     * Renderiza a view principal de Administração com as suas sub-abas.
     * @param {HTMLElement} container - O elemento <main> onde a view será renderizada.
     */
    async function renderAdminView(container) {
        if (currentUser.role !== 'ADMINISTRADOR') {
            container.innerHTML = `<div class="card error-message">Acesso negado. Esta área é restrita a administradores.</div>`;
            return;
        }

        container.innerHTML = `
            <div class="view-header">
                <h1>Administração do Sistema</h1>
            </div>
            <nav class="sub-nav">
                <button class="sub-tab-btn active" data-subview="secoes">Gerir Seções</button>
                <button class="sub-tab-btn" data-subview="users">Gerir Utilizadores</button>
                <button class="sub-tab-btn" data-subview="logs">Logs de Auditoria</button>
            </nav>
            <div id="admin-content-container"></div>
        `;

        const adminContentContainer = container.querySelector('#admin-content-container');

        container.querySelector('.sub-nav').addEventListener('click', (e) => {
            if (e.target.matches('.sub-tab-btn')) {
                const newSubView = e.target.dataset.subview;
                container.querySelectorAll('.sub-tab-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                renderAdminSubView(adminContentContainer, newSubView);
            }
        });
        
        // Carrega a primeira sub-view por defeito
        await renderAdminSubView(adminContentContainer, 'secoes');
    }
    
    /**
     * Roteador para o conteúdo da área de administração.
     * @param {HTMLElement} container - O elemento onde a sub-view será renderizada.
     * @param {string} subView - O nome da sub-view.
     */
    async function renderAdminSubView(container, subView) {
        container.innerHTML = `<div class="loading-spinner"><p>A carregar...</p></div>`;
        switch (subView) {
            case 'users': await renderAdminUsersView(container); break;
            case 'secoes': await renderAdminSeçõesView(container); break;
            case 'logs': await renderAdminLogsView(container); break;
            default: container.innerHTML = 'Selecione uma opção.';
        }
    }

    /**
     * Renderiza a interface para gestão de seções.
     */
    async function renderAdminSeçõesView(container) {
        container.innerHTML = `
            <div class="card">
                <h3>Gerir Seções</h3>
                <p>Adicione, renomeie ou exclua seções da lista utilizada nos formulários.</p>
                <form id="secao-form" class="admin-form">
                    <input type="hidden" name="id">
                    <input type="text" name="nome" placeholder="Nome da nova seção" required>
                    <button type="submit" class="btn btn-primary">Adicionar Seção</button>
                </form>
                <div class="table-container" style="margin-top: 1.5rem;">
                    <table id="secoes-table">
                        <thead><tr><th>ID</th><th>Nome da Seção</th><th class="actions">Ações</th></tr></thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>
        `;
        await loadAndRenderSeçõesTable();
    }

    /**
     * Renderiza a interface para gestão de utilizadores.
     */
    async function renderAdminUsersView(container) {
        container.innerHTML = `
            <div class="card">
                <h3>Gerir Utilizadores</h3>
                <p>Adicione novos utilizadores e defina os seus perfis de acesso.</p>
                <form id="user-form" class="admin-form-grid">
                    <input type="text" name="username" placeholder="Nome de utilizador" required>
                    <input type="email" name="email" placeholder="E-mail" required>
                    <input type="password" name="password" placeholder="Senha" required>
                    <select name="role" required>
                        <option value="OPERADOR">Operador</option>
                        <option value="ADMINISTRADOR">Administrador</option>
                    </select>
                    <button type="submit" class="btn btn-primary">Adicionar Utilizador</button>
                </form>
                <div class="table-container" style="margin-top: 1.5rem;">
                    <table id="users-table">
                        <thead><tr><th>ID</th><th>Utilizador</th><th>E-mail</th><th>Perfil</th><th class="actions">Ações</th></tr></thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>
        `;
        await loadAndRenderUsersTable();
    }

    /**
     * Renderiza a interface para visualização dos logs de auditoria.
     */
    async function renderAdminLogsView(container) {
        container.innerHTML = `
            <div class="card">
                <h3>Log de Auditoria</h3>
                <p>Registo de todas as ações importantes realizadas no sistema.</p>
                <div class="table-container" style="margin-top: 1.5rem;">
                    <table id="logs-table">
                        <thead><tr><th>Data/Hora (UTC)</th><th>Utilizador</th><th>Ação</th><th>Detalhes</th></tr></thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>
        `;
        await loadAndRenderAuditLogsTable();
    }

    // Adiciona o restante das ações ao event listener principal
    appMain.addEventListener('click', async (e) => {
        const target = e.target;
        
        // Ações de exclusão de empenho
        const deleteEmpenhoBtn = target.closest('[data-action="delete-empenho"]');
        if (deleteEmpenhoBtn) {
            const { id, numero } = deleteEmpenhoBtn.dataset;
            showConfirmationModal('Excluir Empenho', `Tem a certeza de que deseja excluir o empenho "${numero}"?`, async () => {
                try {
                    await fetchWithAuth(`/empenhos/${id}`, { method: 'DELETE' });
                    await loadEmpenhosTable(appState.empenhos.page);
                } catch (error) {
                    openModal('Erro ao Excluir', `<p>${error.message}</p>`);
                }
            });
        }
    });

    // ========================================================================
    // 9. INICIALIZAÇÃO DA APLICAÇÃO
    // ========================================================================
    
    // Inicia todo o processo de verificação e renderização.
    initApp();
});
