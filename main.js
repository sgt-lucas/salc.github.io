// main.js
document.addEventListener('DOMContentLoaded', () => {
    // Configuração inicial e estado da aplicação
    const API_URL = 'https://salc.onrender.com';  // Atualize para o novo URL após migração
    const accessToken = localStorage.getItem('accessToken');
    let currentUser = null;
    let appState = {
        secoes: [],
        notasCredito: [],
        empenhos: [],
        users: [],
        auditLogs: [],
    };

    const appNav = document.getElementById('app-nav');
    const appMain = document.getElementById('app-main');
    const usernameDisplay = document.getElementById('username-display');
    const logoutBtn = document.getElementById('logout-btn');
    const modalContainer = document.getElementById('modal-container');
    const modalTemplate = document.getElementById('modal-template');

    // Função auxiliar para requisições à API
    async function fetchWithAuth(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            ...options.headers,
        };

        const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

        if (response.status === 401) {
            logout();
            throw new Error('Sessão expirada. Por favor, faça login novamente.');
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Ocorreu um erro na requisição.');
        }

        return response.status === 204 ? null : response.json();
    }

    // Inicialização e autenticação
    async function initApp() {
        if (!accessToken) {
            window.location.href = 'login.html';
            return;
        }
        try {
            currentUser = await fetchWithAuth('/users/me');
            renderLayout();
            await navigateTo('dashboard');
        } catch (error) {
            console.error('Falha na autenticação ou inicialização:', error);
            logout();
        }
    }

    function logout() {
        localStorage.removeItem('accessToken');
        window.location.href = 'login.html';
    }

    // Renderização do layout e navegação
    function renderLayout() {
        usernameDisplay.textContent = `Usuário: ${currentUser.username} (${currentUser.role})`;
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
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                navigateTo(e.target.dataset.view);
            }
        });
    }

    async function navigateTo(view) {
        appMain.innerHTML = `<div class="loading-spinner"><p>Carregando...</p></div>`;
        switch (view) {
            case 'dashboard':
                await renderDashboardView(appMain);
                break;
            case 'notasCredito':
                await renderNotasCreditoView(appMain);
                break;
            case 'empenhos':
                await renderEmpenhosView(appMain);
                break;
            case 'admin':
                await renderAdminView(appMain);
                break;
            default:
                appMain.innerHTML = `<h1>Página não encontrada</h1>`;
        }
    }

    // Função para abrir modais
    function openModal(title, contentHTML, onOpenCallback) {
        const modalClone = modalTemplate.content.cloneNode(true);
        const modalElement = modalClone.querySelector('.modal');
        modalElement.querySelector('.modal-title').textContent = title;
        modalElement.querySelector('.modal-body').innerHTML = contentHTML;
        modalContainer.innerHTML = '';
        modalContainer.appendChild(modalClone);
        modalContainer.classList.add('active');
        modalElement.querySelector('.modal-close-btn').addEventListener('click', closeModal);
        if (onOpenCallback) onOpenCallback(modalElement);
    }

    function closeModal() {
        modalContainer.classList.remove('active');
        modalContainer.innerHTML = '';
    }

    // Lógica das views
    async function renderDashboardView(container) {
        container.innerHTML = `
            <div class="view-header">
                <h1>Dashboard</h1>
                <button id="generate-report-btn" class="btn btn-primary"><i class="fas fa-file-pdf"></i> Gerar Relatório</button>
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
                        <option value="Expirada">Expirada</option>
                    </select>
                </div>
                <button id="apply-dashboard-filters-btn" class="btn">Aplicar Filtros</button>
            </div>
            <div class="dashboard-grid">
                <div class="card kpi-card">
                    <h3>Saldo Disponível Total</h3>
                    <p id="saldo-total">Carregando...</p>
                </div>
                <div class="card kpi-card">
                    <h3>Total Empenhado</h3>
                    <p id="valor-empenhado">Carregando...</p>
                </div>
                <div class="card kpi-card">
                    <h3>NCs Ativas</h3>
                    <p id="ncs-ativas">Carregando...</p>
                </div>
            </div>
            <div class="card aviso-card">
                <h3><i class="fas fa-exclamation-triangle"></i> Avisos Importantes</h3>
                <div id="aviso-content" class="aviso-content">Carregando...</div>
            </div>
            <div class="card chart-card">
                <h3>Saldo por Seção</h3>
                <div class="chart-container">
                    <canvas id="grafico-secoes"></canvas>
                </div>
            </div>
        `;

        await populateDashboardFilters();
        await loadDashboardData();

        document.getElementById('apply-dashboard-filters-btn').addEventListener('click', loadDashboardData);
        document.getElementById('generate-report-btn').addEventListener('click', generateReport);
    }

    async function populateDashboardFilters() {
        try {
            if (appState.secoes.length === 0) {
                appState.secoes = await fetchWithAuth('/secoes');
            }

            const secaoSelect = document.getElementById('filter-secao');
            secaoSelect.innerHTML = '<option value="">Todas</option>' + appState.secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
        } catch (error) {
            console.error("Erro ao popular filtros do dashboard:", error);
        }
    }

    async function loadDashboardData() {
        const filters = {
            plano_interno: document.getElementById('filter-pi').value,
            nd: document.getElementById('filter-nd').value,
            secao_responsavel_id: document.getElementById('filter-secao').value,
            status: document.getElementById('filter-status').value,
        };

        const params = new URLSearchParams(filters).toString();

        try {
            const [kpis, avisos, graficoSecoesData] = await Promise.all([
                fetchWithAuth('/dashboard/kpis?' + params),
                fetchWithAuth('/dashboard/avisos?' + params),
                fetchWithAuth('/dashboard/grafico-secoes?' + params)
            ]);

            document.getElementById('saldo-total').textContent = kpis.saldo_disponivel_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            document.getElementById('valor-empenhado').textContent = kpis.valor_empenhado_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            document.getElementById('ncs-ativas').textContent = kpis.ncs_ativas;

            const avisosHTML = avisos.length > 0 ? avisos.map(nc => {
                const prazo = new Date(nc.prazo_empenho + 'T00:00:00');
                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);
                const diffTime = prazo - hoje;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                let avisoTexto;
                if (diffDays > 1) {
                    avisoTexto = `Vence em ${diffDays} dias (${prazo.toLocaleDateString('pt-BR')})`;
                } else if (diffDays === 1) {
                    avisoTexto = `Vence amanhã (${prazo.toLocaleDateString('pt-BR')})!`;
                } else if (diffDays < 0) {
                    avisoTexto = `Venceu há ${Math.abs(diffDays)} dias (${prazo.toLocaleDateString('pt-BR')})!`;
                } else {
                    avisoTexto = `Vence hoje (${prazo.toLocaleDateString('pt-BR')})!`;
                }

                return `<div class="aviso-item"><strong>NC ${nc.numero_nc}:</strong> ${avisoTexto}</div>`;
            }).join('') : '<p>Nenhum aviso no momento.</p>';

            document.getElementById('aviso-content').innerHTML = avisosHTML;

            if (typeof Chart === 'undefined') {
                console.error('Chart.js não carregado');
                return;
            }
            renderChart('grafico-secoes', graficoSecoesData.labels, graficoSecoesData.data);
        } catch (error) {
            console.error("Erro ao carregar dados do dashboard:", error);
        }
    }

    async function generateReport() {
        const filters = {
            plano_interno: document.getElementById('filter-pi').value,
            nd: document.getElementById('filter-nd').value,
            secao_responsavel_id: document.getElementById('filter-secao').value,
            status: document.getElementById('filter-status').value,
        };

        const params = new URLSearchParams(filters).toString();

        try {
            const response = await fetch(`${API_URL}/relatorios/pdf?${params}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (!response.ok) {
                throw new Error('Erro ao gerar relatório');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'relatorio.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (error) {
            alert(`Erro ao gerar relatório: ${error.message}`);
        }
    }

    async function renderNotasCreditoView(container) {
        try {
            if (appState.secoes.length === 0) {
                appState.secoes = await fetchWithAuth('/secoes');
            }
            if (appState.notasCredito.length === 0) {
                appState.notasCredito = await fetchWithAuth('/notas-credito');
            }

            container.innerHTML = `
                <div class="view-header">
                    <h1>Notas de Crédito</h1>
                    <button id="add-nc-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Nova NC</button>
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
                            <option value="Expirada">Expirada</option>
                        </select>
                    </div>
                    <button id="apply-filters-btn" class="btn">Aplicar Filtros</button>
                </div>
                <table id="ncs-table">
                    <thead>
                        <tr>
                            <th>Plano Interno</th>
                            <th>ND</th>
                            <th>Nº da NC</th>
                            <th>Seção</th>
                            <th>Valor</th>
                            <th>Saldo Disponível</th>
                            <th>Prazo</th>
                            <th>Status</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            `;

            const secaoSelect = document.getElementById('filter-secao');
            secaoSelect.innerHTML = '<option value="">Todas</option>' + appState.secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');

            document.getElementById('apply-filters-btn').addEventListener('click', loadNotasCredito);
            document.getElementById('add-nc-btn').addEventListener('click', () => {
                const formHTML = getNotaCreditoFormHTML();
                openModal('Nova Nota de Crédito', formHTML, (modalElement) => {
                    modalElement.querySelector('#secao-responsavel').innerHTML = appState.secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
                    modalElement.querySelector('#nc-form').addEventListener('submit', handleNotaCreditoFormSubmit);
                });
            });

            await loadNotasCredito();
        } catch (error) {
            container.innerHTML = `<p class="error-message">Erro ao carregar notas de crédito: ${error.message}</p>`;
        }
    }

    async function loadNotasCredito() {
        const filters = {
            plano_interno: document.getElementById('filter-pi').value,
            nd: document.getElementById('filter-nd').value,
            secao_responsavel_id: document.getElementById('filter-secao').value,
            status: document.getElementById('filter-status').value,
        };

        const params = new URLSearchParams(filters).toString();

        try {
            appState.notasCredito = await fetchWithAuth(`/notas-credito?${params}`);
            const tbody = document.querySelector('#ncs-table tbody');
            tbody.innerHTML = appState.notasCredito.map(nc => `
                <tr>
                    <td>${nc.plano_interno}</td>
                    <td>${nc.nd}</td>
                    <td>${nc.numero_nc}</td>
                    <td>${nc.secao_responsavel.nome}</td>
                    <td>${nc.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${nc.saldo_disponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(nc.prazo_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td>${nc.status}</td>
                    <td>
                        <button class="action-btn view-btn" data-id="${nc.id}" title="Ver Extrato"><i class="fas fa-eye"></i></button>
                        <button class="action-btn edit-btn" data-id="${nc.id}" title="Editar"><i class="fas fa-edit"></i></button>
                        ${currentUser.role === 'ADMINISTRADOR' ? `<button class="action-btn delete-btn" data-id="${nc.id}" title="Excluir"><i class="fas fa-trash"></i></button>` : ''}
                    </td>
                </tr>
            `).join('');

            document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => renderExtratoNc(btn.dataset.id)));
            document.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', () => editNotaCredito(btn.dataset.id)));
            document.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', () => deleteNotaCredito(btn.dataset.id)));
        } catch (error) {
            document.querySelector('#ncs-table tbody').innerHTML = `<tr><td colspan="9">Erro ao carregar: ${error.message}</td></tr>`;
        }
    }

    function getNotaCreditoFormHTML(nc = null) {
        return `
            <form id="nc-form">
                <div class="form-grid">
                    <div class="form-field"><label for="numero-nc">Nº da NC</label><input type="text" name="numero_nc" value="${nc?.numero_nc || ''}" required></div>
                    <div class="form-field"><label for="valor">Valor (R$)</label><input type="number" name="valor" step="0.01" value="${nc?.valor || ''}" required></div>
                    <div class="form-field"><label for="esfera">Esfera</label><input type="text" name="esfera" value="${nc?.esfera || ''}" required></div>
                    <div class="form-field"><label for="fonte">Fonte</label><input type="text" name="fonte" value="${nc?.fonte || ''}" required></div>
                    <div class="form-field"><label for="ptres">PTRES</label><input type="text" name="ptres" value="${nc?.ptres || ''}" required></div>
                    <div class="form-field"><label for="plano-interno">Plano Interno</label><input type="text" name="plano_interno" value="${nc?.plano_interno || ''}" required></div>
                    <div class="form-field"><label for="nd">Natureza de Despesa</label><input type="text" name="nd" value="${nc?.nd || ''}" required></div>
                    <div class="form-field"><label for="data-chegada">Data de Chegada</label><input type="date" name="data_chegada" value="${nc?.data_chegada || ''}" required></div>
                    <div class="form-field"><label for="prazo-empenho">Prazo para Empenho</label><input type="date" name="prazo_empenho" value="${nc?.prazo_empenho || ''}" required></div>
                    <div class="form-field"><label for="secao-responsavel">Seção Responsável</label>
                        <select name="secao_responsavel_id" id="secao-responsavel" required></select>
                    </div>
                    <div class="form-field form-field-full"><label for="descricao">Descrição</label><textarea name="descricao">${nc?.descricao || ''}</textarea></div>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">Salvar</button>
                </div>
            </form>
        `;
    }

    async function handleNotaCreditoFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        data.valor = parseFloat(data.valor);
        data.secao_responsavel_id = parseInt(data.secao_responsavel_id);

        const method = form.dataset.id ? 'PUT' : 'POST';
        const url = form.dataset.id ? `/notas-credito/${form.dataset.id}` : '/notas-credito/';

        try {
            await fetchWithAuth(url, { method, body: JSON.stringify(data) });
            closeModal();
            await loadNotasCredito();
        } catch (error) {
            alert(`Erro ao salvar nota de crédito: ${error.message}`);
        }
    }

    async function editNotaCredito(id) {
        const nc = appState.notasCredito.find(nc => nc.id === parseInt(id));
        if (!nc) return;
        const formHTML = getNotaCreditoFormHTML(nc);
        openModal(`Editar Nota de Crédito ${nc.numero_nc}`, formHTML, (modalElement) => {
            modalElement.querySelector('#secao-responsavel').innerHTML = appState.secoes.map(s => `<option value="${s.id}" ${s.id === nc.secao_responsavel_id ? 'selected' : ''}>${s.nome}</option>`).join('');
            modalElement.querySelector('#nc-form').dataset.id = id;
            modalElement.querySelector('#nc-form').addEventListener('submit', handleNotaCreditoFormSubmit);
        });
    }

    async function deleteNotaCredito(id) {
        if (!confirm('Tem certeza que deseja excluir esta nota de crédito?')) return;
        try {
            await fetchWithAuth(`/notas-credito/${id}`, { method: 'DELETE' });
            await loadNotasCredito();
        } catch (error) {
            alert(`Erro ao excluir nota de crédito: ${error.message}`);
        }
    }

    async function renderExtratoNc(id) {
        try {
            const nc = await fetchWithAuth(`/notas-credito/${id}`);
            const empenhos = await fetchWithAuth(`/empenhos?nota_credito_id=${id}`);
            const recolhimentos = await fetchWithAuth(`/recolhimentos-saldo?nota_credito_id=${id}`);

            const empenhosHTML = empenhos.length > 0 ? empenhos.map(e => `
                <tr>
                    <td>${e.numero_ne}</td>
                    <td>${e.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(e.data_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td>${e.observacao || ''}</td>
                </tr>
            `).join('') : '<tr><td colspan="4">Nenhum empenho associado.</td></tr>';

            const recolhimentosHTML = recolhimentos.length > 0 ? recolhimentos.map(r => `
                <tr>
                    <td>${r.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(r.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td>${r.observacao || ''}</td>
                </tr>
            `).join('') : '<tr><td colspan="3">Nenhum recolhimento registrado.</td></tr>';

            const contentHTML = `
                <h3>Detalhes da NC ${nc.numero_nc}</h3>
                <p><strong>Plano Interno:</strong> ${nc.plano_interno}</p>
                <p><strong>Natureza de Despesa:</strong> ${nc.nd}</p>
                <p><strong>Seção:</strong> ${nc.secao_responsavel.nome}</p>
                <p><strong>Valor Original:</strong> ${nc.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                <p><strong>Saldo Disponível:</strong> ${nc.saldo_disponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                <p><strong>Prazo:</strong> ${new Date(nc.prazo_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                <p><strong>Status:</strong> ${nc.status}</p>
                <h4>Empenhos Associados</h4>
                <table>
                    <thead>
                        <tr><th>Nº do Empenho</th><th>Valor</th><th>Data</th><th>Observação</th></tr>
                    </thead>
                    <tbody>${empenhosHTML}</tbody>
                </table>
                <h4>Recolhimentos de Saldo</h4>
                <button id="add-recolhimento-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Adicionar Recolhimento</button>
                <table>
                    <thead>
                        <tr><th>Valor</th><th>Data</th><th>Observação</th></tr>
                    </thead>
                    <tbody>${recolhimentosHTML}</tbody>
                </table>
            `;

            openModal(`Extrato da Nota de Crédito ${nc.numero_nc}`, contentHTML, (modalElement) => {
                modalElement.querySelector('#add-recolhimento-btn').addEventListener('click', () => {
                    const formHTML = getRecolhimentoFormHTML(id);
                    openModal('Adicionar Recolhimento de Saldo', formHTML, (modalElem) => {
                        modalElem.querySelector('#recolhimento-form').addEventListener('submit', (e) => handleRecolhimentoFormSubmit(e, id));
                    });
                });
            });
        } catch (error) {
            alert(`Erro ao carregar extrato: ${error.message}`);
        }
    }

    function getRecolhimentoFormHTML(ncId) {
        return `
            <form id="recolhimento-form">
                <div class="form-grid">
                    <div class="form-field"><label for="valor">Valor (R$)</label><input type="number" name="valor" step="0.01" required></div>
                    <div class="form-field"><label for="data">Data</label><input type="date" name="data" required></div>
                    <div class="form-field form-field-full"><label for="observacao">Observação</label><textarea name="observacao"></textarea></div>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">Criar Recolhimento</button>
                </div>
            </form>
        `;
    }

    async function handleRecolhimentoFormSubmit(e, ncId) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        data.valor = parseFloat(data.valor);
        data.nota_credito_id = ncId;

        try {
            await fetchWithAuth('/recolhimentos-saldo/', { method: 'POST', body: JSON.stringify(data) });
            closeModal();
            renderExtratoNc(ncId);  // Atualiza o extrato
        } catch (error) {
            alert(`Erro ao salvar recolhimento: ${error.message}`);
        }
    }

    async function renderEmpenhosView(container) {
        try {
            if (appState.secoes.length === 0) {
                appState.secoes = await fetchWithAuth('/secoes');
            }
            if (appState.notasCredito.length === 0) {
                appState.notasCredito = await fetchWithAuth('/notas-credito');
            }
            if (appState.empenhos.length === 0) {
                appState.empenhos = await fetchWithAuth('/empenhos');
            }

            container.innerHTML = `
                <div class="view-header">
                    <h1>Empenhos</h1>
                    <button id="add-empenho-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Novo Empenho</button>
                </div>
                <table id="empenhos-table">
                    <thead>
                        <tr>
                            <th>Nº do Empenho</th>
                            <th>NC</th>
                            <th>Seção Requisitante</th>
                            <th>Valor</th>
                            <th>Data</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            `;

            document.getElementById('add-empenho-btn').addEventListener('click', () => {
                const formHTML = getEmpenhoFormHTML();
                openModal('Novo Empenho', formHTML, (modalElement) => {
                    modalElement.querySelector('#nota-credito-id').innerHTML = appState.notasCredito.map(nc => `<option value="${nc.id}">${nc.numero_nc}</option>`).join('');
                    modalElement.querySelector('#secao-requisitante').innerHTML = appState.secoes.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
                    modalElement.querySelector('#empenho-form').addEventListener('submit', handleEmpenhoFormSubmit);
                });
            });

            await loadEmpenhos();
        } catch (error) {
            container.innerHTML = `<p class="error-message">Erro ao carregar empenhos: ${error.message}</p>`;
        }
    }

    async function loadEmpenhos() {
        try {
            appState.empenhos = await fetchWithAuth('/empenhos');
            const tbody = document.querySelector('#empenhos-table tbody');
            tbody.innerHTML = appState.empenhos.map(e => `
                <tr>
                    <td>${e.numero_ne}</td>
                    <td>${appState.notasCredito.find(nc => nc.id === e.nota_credito_id)?.numero_nc || 'N/A'}</td>
                    <td>${appState.secoes.find(s => s.id === e.secao_requisitante_id)?.nome || 'N/A'}</td>
                    <td>${e.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>${new Date(e.data_empenho + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td>
                        <button class="action-btn edit-btn" data-id="${e.id}" title="Editar"><i class="fas fa-edit"></i></button>
                        ${currentUser.role === 'ADMINISTRADOR' ? `<button class="action-btn delete-btn" data-id="${e.id}" title="Excluir"><i class="fas fa-trash"></i></button>` : ''}
                    </td>
                </tr>
            `).join('');

            document.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', () => editEmpenho(btn.dataset.id)));
            document.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', () => deleteEmpenho(btn.dataset.id)));
        } catch (error) {
            document.querySelector('#empenhos-table tbody').innerHTML = `<tr><td colspan="6">Erro ao carregar: ${error.message}</td></tr>`;
        }
    }

    function getEmpenhoFormHTML(empenho = null) {
        return `
            <form id="empenho-form" ${empenho ? `data-id="${empenho.id}"` : ''}>
                <div class="form-grid">
                    <div class="form-field"><label for="numero-ne">Nº do Empenho</label><input type="text" name="numero_ne" value="${empenho?.numero_ne || ''}" required></div>
                    <div class="form-field"><label for="valor">Valor (R$)</label><input type="number" name="valor" step="0.01" value="${empenho?.valor || ''}" required></div>
                    <div class="form-field"><label for="data-empenho">Data do Empenho</label><input type="date" name="data_empenho" value="${empenho?.data_empenho || ''}" required></div>
                    <div class="form-field"><label for="nota-credito-id">Nota de Crédito</label>
                        <select name="nota_credito_id" id="nota-credito-id" required></select>
                    </div>
                    <div class="form-field"><label for="secao-requisitante">Seção Requisitante</label>
                        <select name="secao_requisitante_id" id="secao-requisitante" required></select>
                    </div>
                    <div class="form-field form-field-full"><label for="observacao">Observação</label><textarea name="observacao">${empenho?.observacao || ''}</textarea></div>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">Salvar</button>
                </div>
            </form>
        `;
    }

    async function handleEmpenhoFormSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        data.valor = parseFloat(data.valor);
        data.nota_credito_id = parseInt(data.nota_credito_id);
        data.secao_requisitante_id = parseInt(data.secao_requisitante_id);

        const method = form.dataset.id ? 'PUT' : 'POST';
        const url = form.dataset.id ? `/empenhos/${form.dataset.id}` : '/empenhos/';

        try {
            await fetchWithAuth(url, { method, body: JSON.stringify(data) });
            closeModal();
            await loadEmpenhos();
        } catch (error) {
            alert(`Erro ao salvar empenho: ${error.message}`);
        }
    }

    async function editEmpenho(id) {
        const empenho = appState.empenhos.find(e => e.id === parseInt(id));
        if (!empenho) return;
        const formHTML = getEmpenhoFormHTML(empenho);
        openModal(`Editar Empenho ${empenho.numero_ne}`, formHTML, (modalElement) => {
            modalElement.querySelector('#nota-credito-id').innerHTML = appState.notasCredito.map(nc => `<option value="${nc.id}" ${nc.id === empenho.nota_credito_id ? 'selected' : ''}>${nc.numero_nc}</option>`).join('');
            modalElement.querySelector('#secao-requisitante').innerHTML = appState.secoes.map(s => `<option value="${s.id}" ${s.id === empenho.secao_requisitante_id ? 'selected' : ''}>${s.nome}</option>`).join('');
            modalElement.querySelector('#empenho-form').addEventListener('submit', handleEmpenhoFormSubmit);
        });
    }

    async function deleteEmpenho(id) {
        if (!confirm('Tem certeza que deseja excluir este empenho?')) return;
        try {
            await fetchWithAuth(`/empenhos/${id}`, { method: 'DELETE' });
            await loadEmpenhos();
        } catch (error) {
            alert(`Erro ao excluir empenho: ${error.message}`);
        }
    }

    async function renderAdminView(container) {
        try {
            if (appState.users.length === 0) {
                appState.users = await fetchWithAuth('/users');
            }
            if (appState.auditLogs.length === 0) {
                appState.auditLogs = await fetchWithAuth('/audit-logs');
            }

            container.innerHTML = `
                <div class="view-header">
                    <h1>Administração</h1>
                    <button id="add-user-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Novo Usuário</button>
                </div>
                <h2>Usuários</h2>
                <table id="users-table">
                    <thead>
                        <tr><th>Username</th><th>Email</th><th>Função</th><th>Ações</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
                <h2>Log de Auditoria</h2>
                <table id="audit-table">
                    <thead>
                        <tr><th>Data/Hora</th><th>Usuário</th><th>Ação</th><th>Detalhes</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
            `;

            document.getElementById('add-user-btn').addEventListener('click', () => {
                const formHTML = `
                    <form id="user-form">
                        <div class="form-grid">
                            <div class="form-field"><label for="username">Username</label><input type="text" name="username" required></div>
                            <div class="form-field"><label for="email">Email</label><input type="email" name="email" required></div>
                            <div class="form-field"><label for="password">Senha</label><input type="password" name="password" required></div>
                            <div class="form-field"><label for="role">Função</label>
                                <select name="role" required>
                                    <option value="OPERADOR">Operador</option>
                                    <option value="ADMINISTRADOR">Administrador</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">Criar Usuário</button>
                        </div>
                    </form>
                `;
                openModal('Novo Usuário', formHTML, (modalElement) => {
                    modalElement.querySelector('#user-form').addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const formData = new FormData(e.target);
                        const data = Object.fromEntries(formData.entries());
                        try {
                            await fetchWithAuth('/users/', { method: 'POST', body: JSON.stringify(data) });
                            closeModal();
                            appState.users = await fetchWithAuth('/users');
                            loadAdminTables();
                        } catch (error) {
                            alert(`Erro ao criar usuário: ${error.message}`);
                        }
                    });
                });
            });

            loadAdminTables();
        } catch (error) {
            container.innerHTML = `<p class="error-message">Erro ao carregar administração: ${error.message}</p>`;
        }
    }

    function loadAdminTables() {
        const usersTbody = document.querySelector('#users-table tbody');
        usersTbody.innerHTML = appState.users.map(u => `
            <tr>
                <td>${u.username}</td>
                <td>${u.email}</td>
                <td>${u.role}</td>
                <td>
                    <button class="action-btn delete-btn" data-id="${u.id}" title="Excluir"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');

        const auditTbody = document.querySelector('#audit-table tbody');
        auditTbody.innerHTML = appState.auditLogs.map(log => `
            <tr>
                <td>${new Date(log.timestamp).toLocaleString('pt-BR')}</td>
                <td>${log.username}</td>
                <td>${log.action}</td>
                <td>${log.details || ''}</td>
            </tr>
        `).join('');

        document.querySelectorAll('#users-table .delete-btn').forEach(btn => btn.addEventListener('click', async () => {
            if (!confirm('Tem certeza que deseja excluir este usuário?')) return;
            try {
                await fetchWithAuth(`/users/${btn.dataset.id}`, { method: 'DELETE' });
                appState.users = await fetchWithAuth('/users');
                loadAdminTables();
            } catch (error) {
                alert(`Erro ao excluir usuário: ${error.message}`);
            }
        }));
    }

    function renderChart(canvasId, labels, data) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Saldo Disponível (R$)',
                    data: data,
                    backgroundColor: 'rgba(0, 51, 102, 0.6)',
                    borderColor: 'rgba(0, 51, 102, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return 'R$ ' + value.toLocaleString('pt-BR');
                            }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }

    initApp();
});
