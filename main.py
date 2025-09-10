import os
import io
import enum
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator, Field, EmailStr
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey, DateTime, Enum as SQLAlchemyEnum
from sqlalchemy.orm import sessionmaker, Session, relationship
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql import func

# --- Segurança e Autenticação ---
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

# ==============================================================================
# 1. CONFIGURAÇÃO INICIAL E DE SEGURANÇA
# ==============================================================================

# Chave secreta para assinar os tokens JWT. DEVE ser substituída por uma variável de ambiente segura.
SECRET_KEY = os.getenv("SECRET_KEY", "b40d648f5728a3f5a250390a7891785f24f4699564177d7042880b2a75877c8e")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # Token expira em 1 hora

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# ==============================================================================
# 2. CONFIGURAÇÃO DO BANCO DE DADOS
# ==============================================================================

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL is None:
    raise RuntimeError("FATAL: A variável de ambiente DATABASE_URL não está configurada.")

# SQLAlchemy 2.0+ prefere 'postgresql://' ao invés de 'postgres://' que alguns provedores usam.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ==============================================================================
# 3. MODELOS DO BANCO DE DADOS (SQLAlchemy)
# ==============================================================================

class UserRole(str, enum.Enum):
    OPERADOR = "OPERADOR"
    ADMINISTRADOR = "ADMINISTRADOR"

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(SQLAlchemyEnum(UserRole), nullable=False, default=UserRole.OPERADOR)

class Seção(Base):
    __tablename__ = "secoes"
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String, unique=True, nullable=False)

class NotaCredito(Base):
    __tablename__ = "notas_credito"
    id = Column(Integer, primary_key=True, index=True)
    numero_nc = Column(String, unique=True, nullable=False)
    valor = Column(Float, nullable=False)
    esfera = Column(String)
    fonte = Column(String(10))
    ptres = Column(String(6))
    plano_interno = Column(String, index=True)
    nd = Column(String(6), index=True)
    data_chegada = Column(Date)
    prazo_empenho = Column(Date)
    descricao = Column(String)
    secao_responsavel_id = Column(Integer, ForeignKey("secoes.id"), index=True)
    saldo_disponivel = Column(Float, nullable=False)
    status = Column(String, default="Ativa", index=True)
    secao_responsavel = relationship("Seção")
    empenhos = relationship("Empenho", back_populates="nota_credito", cascade="all, delete-orphan")

class Empenho(Base):
    __tablename__ = "empenhos"
    id = Column(Integer, primary_key=True, index=True)
    numero_ne = Column(String, unique=True, nullable=False)
    valor = Column(Float, nullable=False)
    data_empenho = Column(Date)
    observacao = Column(String)
    nota_credito_id = Column(Integer, ForeignKey("notas_credito.id"))
    secao_requisitante_id = Column(Integer, ForeignKey("secoes.id"))
    nota_credito = relationship("NotaCredito", back_populates="empenhos")
    secao_requisitante = relationship("Seção")

class AnulacaoEmpenho(Base):
    __tablename__ = "anulacoes_empenho"
    id = Column(Integer, primary_key=True, index=True)
    empenho_id = Column(Integer, ForeignKey("empenhos.id"))
    valor = Column(Float, nullable=False)
    data = Column(Date, nullable=False)
    observacao = Column(String)
    empenho = relationship("Empenho")

class RecolhimentoSaldo(Base):
    __tablename__ = "recolhimentos_saldo"
    id = Column(Integer, primary_key=True, index=True)
    nota_credito_id = Column(Integer, ForeignKey("notas_credito.id"))
    valor = Column(Float, nullable=False)
    data = Column(Date, nullable=False)
    observacao = Column(String)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    username = Column(String, nullable=False)
    action = Column(String)
    details = Column(String)

# ==============================================================================
# 4. SCHEMAS DE DADOS (Pydantic)
# ==============================================================================

# Schemas de Usuário
class UserBase(BaseModel):
    username: str
    email: EmailStr

class UserCreate(UserBase):
    password: str
    role: UserRole

class UserInDB(UserBase):
    id: int
    role: UserRole
    class Config:
        from_attributes = True

# Schemas de Seção
class SeçãoBase(BaseModel):
    nome: str

class SeçãoCreate(SeçãoBase):
    pass

class SeçãoInDB(SeçãoBase):
    id: int
    class Config:
        from_attributes = True

# Schemas de Nota de Crédito
class NotaCreditoBase(BaseModel):
    numero_nc: str
    valor: float = Field(..., gt=0)
    esfera: str
    fonte: str = Field(..., max_length=10)
    ptres: str = Field(..., max_length=6)
    plano_interno: str
    nd: str = Field(..., max_length=6, pattern=r'^\d{6}$')
    data_chegada: date
    prazo_empenho: date
    descricao: Optional[str] = None
    secao_responsavel_id: int

class NotaCreditoCreate(NotaCreditoBase):
    pass

class NotaCreditoInDB(NotaCreditoBase):
    id: int
    saldo_disponivel: float
    status: str
    secao_responsavel: SeçãoInDB
    class Config:
        from_attributes = True

# ... (outros Schemas para Empenho, Anulação, Recolhimento, etc., seriam definidos aqui)

# ==============================================================================
# 5. UTILITÁRIOS E DEPENDÊNCIAS
# ==============================================================================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_audit_log(db: Session, user: User, action: str, details: str = ""):
    log_entry = AuditLog(username=user.username, action=action, details=details)
    db.add(log_entry)

# Funções de Segurança
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Não foi possível validar as credenciais",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

async def get_current_operator_user(current_user: User = Depends(get_current_user)):
    if current_user.role not in [UserRole.OPERADOR, UserRole.ADMINISTRADOR]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão insuficiente. Requer perfil de Operador.")
    return current_user

async def get_current_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role != UserRole.ADMINISTRADOR:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permissão insuficiente. Requer perfil de Administrador.")
    return current_user

# ==============================================================================
# 6. APLICAÇÃO FastAPI E ENDPOINTS
# ==============================================================================

app = FastAPI(
    title="Sistema de Gestão de Notas de Crédito",
    description="API para controle de execução orçamentária do 2º CGEO.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # IMPORTANTE: Em produção, restrinja para o domínio do seu frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)

# --- Endpoint de Autenticação ---
@app.post("/token", summary="Autentica o usuário e retorna um token JWT")
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

# --- Endpoint de Usuários ---
@app.get("/users/me", response_model=UserInDB, summary="Retorna informações do usuário logado")
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

@app.post("/users", response_model=UserInDB, status_code=status.HTTP_201_CREATED, summary="Cria um novo usuário (Apenas Admins)")
def create_user(user: UserCreate, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Usuário já existe")
    hashed_password = get_password_hash(user.password)
    new_user = User(username=user.username, email=user.email, hashed_password=hashed_password, role=user.role)
    db.add(new_user)
    create_audit_log(db, admin_user, "CRIAR USUÁRIO", f"Usuário '{user.username}' criado com perfil '{user.role.value}'.")
    db.commit()
    db.refresh(new_user)
    return new_user

# --- Endpoints de Seções ---
@app.post("/secoes", status_code=status.HTTP_201_CREATED, summary="Adiciona uma nova seção (Operadores e Admins)")
def create_secao(secao: SeçãoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_operator_user)):
    db_secao = Seção(nome=secao.nome)
    db.add(db_secao)
    create_audit_log(db, current_user, "CRIAR SEÇÃO", f"Seção '{secao.nome}' criada.")
    db.commit()
    db.refresh(db_secao)
    return db_secao

@app.get("/secoes", summary="Lista todas as seções")
def read_secoes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Seção).order_by(Seção.nome).all()

# ... (Endpoints PUT e DELETE para Seções seriam implementados aqui, com a devida checagem de perfil de Admin)

# --- Endpoints de Notas de Crédito ---
@app.post("/notas-credito", status_code=status.HTTP_201_CREATED, summary="Cadastra uma nova Nota de Crédito")
def create_nota_credito(nc: NotaCreditoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_operator_user)):
    # Lógica de negócio completa para criar uma NC, incluindo cálculo de saldo, status e log de auditoria
    db_nc = NotaCredito(**nc.dict(), saldo_disponivel=nc.valor, status="Ativa")
    db.add(db_nc)
    create_audit_log(db, current_user, "CRIAR NC", f"NC '{nc.numero_nc}' criada com valor R$ {nc.valor:.2f}.")
    db.commit()
    db.refresh(db_nc)
    return db_nc

# ... (Todos os outros endpoints para GET, PUT, DELETE de NCs, Empenhos, Anulações, Recolhimentos, Dashboard, Relatórios e Logs seriam definidos aqui, seguindo o mesmo padrão de segurança e lógica.)

print("API pronta para iniciar.")
