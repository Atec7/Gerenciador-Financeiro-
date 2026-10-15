document.addEventListener('DOMContentLoaded', () => {
    loadTransactions();
    loadGoal();
    updateCharts();
});

function loadTransactions() {
    const transactions = JSON.parse(localStorage.getItem('transactions')) || [];
    const transactionTableBody = document.getElementById('transaction-table-body');
    const totalBalance = document.getElementById('total-balance');
    const totalIncome = document.getElementById('total-income');
    const totalExpense = document.getElementById('total-expense');

    let balance = 0;
    let income = 0;
    let expenses = 0;

    transactionTableBody.innerHTML = '';
    transactions.forEach((transaction, index) => {
        const amount = parseFloat(transaction.amount);
        if (transaction.type === 'Receita') {
            income += amount;
        } else {
            expenses += amount;
        }
        balance = income - expenses;

        const dueDate = transaction.dueDate ? formatDate(transaction.dueDate) : 'N/A';
        const daysToDue = transaction.dueDate ? calculateDaysToDue(transaction.dueDate) : 'N/A';

        const row = document.createElement('tr');
        row.classList.toggle('paid', transaction.paid);
        row.innerHTML = `
            <td>${transaction.description}</td>
            <td>R$ ${transaction.amount}</td>
            <td>${transaction.type}</td>
            <td>${transaction.category}</td>
            <td>${dueDate}</td>
            <td>${daysToDue}</td>
            <td><button onclick="togglePaid(${index})">${transaction.paid ? 'Pago' : 'Pendente'}</button></td>
            <td>
                <button onclick="editTransaction(${index})">Editar</button>
                <button onclick="deleteTransaction(${index})">Deletar</button>
            </td>
        `;
        transactionTableBody.appendChild(row);
    });

    totalBalance.textContent = balance.toFixed(2);
    totalIncome.textContent = income.toFixed(2);
    totalExpense.textContent = expenses.toFixed(2);
}

function addTransaction() {
    const description = document.getElementById('description').value;
    const amount = document.getElementById('amount').value;
    const type = document.getElementById('type').value;
    const category = document.getElementById('category').value;
    const dueDate = document.getElementById('due-date').value;

    if (description && amount && type && category) {
        const transactions = JSON.parse(localStorage.getItem('transactions')) || [];
        transactions.push({ description, amount, type, category, dueDate, paid: false });
        localStorage.setItem('transactions', JSON.stringify(transactions));
        loadTransactions();
        updateCharts();
        document.getElementById('description').value = '';
        document.getElementById('amount').value = '';
        document.getElementById('due-date').value = '';
    } else {
        alert('Por favor, preencha todos os campos.');
    }
}

function togglePaid(index) {
    const transactions = JSON.parse(localStorage.getItem('transactions')) || [];
    transactions[index].paid = !transactions[index].paid;
    localStorage.setItem('transactions', JSON.stringify(transactions));
    loadTransactions();
}

function editTransaction(index) {
    const transactions = JSON.parse(localStorage.getItem('transactions')) || [];
    const transaction = transactions[index];
    document.getElementById('description').value = transaction.description;
    document.getElementById('amount').value = transaction.amount;
    document.getElementById('type').value = transaction.type;
    document.getElementById('category').value = transaction.category;
    document.getElementById('due-date').value = transaction.dueDate;
    deleteTransaction(index);
}

function deleteTransaction(index) {
    const transactions = JSON.parse(localStorage.getItem('transactions')) || [];
    transactions.splice(index, 1);
    localStorage.setItem('transactions', JSON.stringify(transactions));
    loadTransactions();
    updateCharts();
}

function formatDate(dateString) {
    const options = { day: '2-digit', month: '2-digit', year: '2-digit' };
    return new Date(dateString).toLocaleDateString('pt-BR', options);
}

function calculateDaysToDue(dateString) {
    const dueDate = new Date(dateString);
    const today = new Date();
    const timeDiff = dueDate.getTime() - today.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
    return daysDiff >= 0 ? daysDiff : 'Vencido';
}

function updateCharts() {
    const transactions = JSON.parse(localStorage.getItem('transactions')) || [];
    const categories = ['Alimentação', 'Transporte', 'Moradia', 'Lazer', 'Saúde', 'Educação', 'Outros'];
    const expenseData = categories.map(category => {
        return transactions.filter(t => t.type === 'Despesa' && t.category === category)
                           .reduce((total, t) => total + parseFloat(t.amount), 0);
    });

    const expenseCtx = document.getElementById('expenseChart').getContext('2d');
    new Chart(expenseCtx, {
        type: 'pie',
        data: {
            labels: categories,
            datasets: [{
                label: 'Despesas por Categoria',
                data: expenseData,
                backgroundColor: ['#ff6384', '#36a2eb', '#cc65fe', '#ffce56', '#ff9f40', '#4bc0c0', '#9966ff'],
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'top',
                }
            }
        }
    });

    const goal = parseFloat(localStorage.getItem('financialGoal')) || 0;
    const balance = parseFloat(document.getElementById('total-balance').textContent) || 0;
    const remainingBalance = balance - goal;

    const goalCtx = document.getElementById('goalChart').getContext('2d');
    new Chart(goalCtx, {
        type: 'bar',
        data: {
            labels: ['Saldo Restante'],
            datasets: [
                {
                    label: 'Saldo Real',
                    data: [remainingBalance],
                    backgroundColor: '#36a2eb',
                },
                {
                    label: 'Meta Financeira',
                    data: [goal],
                    backgroundColor: '#ff6384',
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function setGoal() {
    const goal = document.getElementById('financial-goal').value;
    if (goal) {
        localStorage.setItem('financialGoal', goal);
        updateCharts();
    } else {
        alert('Por favor, insira um valor para a meta financeira.');
    }
}

function loadGoal() {
    const goal = localStorage.getItem('financialGoal') || 0;
    document.getElementById('financial-goal').value = goal;
}

function downloadReport() {
    html2canvas(document.querySelector('.container')).then(canvas => {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = 'relatorio_financeiro.png';
        link.click();
    });
}