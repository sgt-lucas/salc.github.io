import os
import io
import enum
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, status, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey, DateTime, Enum as SQLAlchemyEnum, desc
from sqlalchemy.orm import sessionmaker, Session, relationship, DeclarativeBase
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql import func

# Segurança e Autenticação
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

# PDF Reporting
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch

app = FastAPI(title="Sistema de Gestão de Notas de Crédito", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Ajuste para domínios específicos em produção
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

if SECRET_KEY is None:
    raise RuntimeError("FATAL: A variável de ambiente SECRET_KEY não está configurada.")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL is None:
    raise RuntimeError("FATAL: A variável de ambiente DATABASE_URL não está configurada.")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

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
    notas_credito = relationship("NotaCredito", back_populates="secao_responsavel")
    empenhos = relationship("Empenho", back_populates="secao_requisitante")

class NotaCredito(Base):
    __tablename__ = "notas_credito"
    id = Column(Integer, primary_key=True, index=True)
    numero_nc = Column(String, unique=True, nullable=False, index=True)
    valor = Column(Float, nullable=False)
    esfera = Column(String)
    fonte = Column(String(10))
    ptres = Column(String(6))
    plano_interno = Column(String, index=True)
    nd = Column(String(6), index=True)
    data_chegada = Column(Date)
    prazo_empenho = Column(Date)
    descricao = Column(String, nullable=True)
    secao_responsavel_id = Column(Integer, ForeignKey("secoes.id", ondelete="CASCADE"), index=True)
    saldo_disponivel = Column(Float, nullable=False)
    status = Column(String, default="Ativa", index=True)
    
    secao_responsavel = relationship("Seção", back_populates="notas_credito")
    empenhos = relationship("Empenho", back_populates="nota_credito", cascade="all, delete-orphan", passive_deletes=True)
    recolhimentos = relationship("RecolhimentoSaldo", back_populates="nota_credito", cascade="all, delete-orphan", passive_deletes=True)

class Empenho(Base):
    __tablename__ = "empenhos"
    id = Column(Integer, primary_key=True, index=True)
    numero_ne = Column(String, unique=True, nullable=False, index=True)
    valor = Column(Float, nullable=False)
    data_empenho = Column(Date)
    observacao = Column(String, nullable=True)
    nota_credito_id = Column(Integer, ForeignKey("notas_credito.id", ondelete="CASCADE"))
    secao_requisitante_id = Column(Integer, ForeignKey("secoes.id", ondelete="CASCADE"))
    
    nota_credito = relationship("NotaCredito", back_populates="empenhos")
    secao_requisitante = relationship("Seção", back_populates="empenhos")
    anulacoes = relationship("AnulacaoEmpenho", back_populates="empenho", cascade="all, delete-orphan", passive_deletes=True)

class AnulacaoEmpenho(Base):
    __tablename__ = "anulacoes_empenho"
    id = Column(Integer, primary_key=True, index=True)
    empenho_id = Column(Integer, ForeignKey("empenhos.id", ondelete="CASCADE"))
    valor = Column(Float, nullable=False)
    data = Column(Date, nullable=False)
    observacao = Column(String, nullable=True)
    
    empenho = relationship("Empenho", back_populates="anulacoes")

class RecolhimentoSaldo(Base):
    __tablename__ = "recolhimentos_saldo"
    id = Column(Integer, primary_key=True, index=True)
    nota_credito_id = Column(Integer, ForeignKey("notas_credito.id", ondelete="CASCADE"))
    valor = Column(Float, nullable=False)
    data = Column(Date, nullable=False)
    observacao = Column(String, nullable=True)
    
    nota_credito = relationship("NotaCredito", back_populates="recolhimentos")

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    username = Column(String, nullable=False)
    action = Column(String, nullable=False)
    details = Column(String, nullable=True)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

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
        detail="Could not validate credentials",
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

async def get_current_admin_user(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.role != UserRole.ADMINISTRADOR:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return current_user

def log_audit_action(db: Session, username: str, action: str, details: str = None):
    log = AuditLog(username=username, action=action, details=details)
    db.add(log)
    db.commit()

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: UserRole

class UserInDB(BaseModel):
    id: int
    username: str
    email: EmailStr
    role: UserRole

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class SeçãoCreate(BaseModel):
    nome: str

class SeçãoInDB(BaseModel):
    id: int
    nome: str

    class Config:
        from_attributes = True

class NotaCreditoCreate(BaseModel):
    numero_nc: str
    valor: float = Field(ge=0)
    esfera: str
    fonte: str
    ptres: str
    plano_interno: str
    nd: str
    data_chegada: date
    prazo_empenho: date
    descricao: Optional[str] = None
    secao_responsavel_id: int
    saldo_disponivel: Optional[float] = Field(ge=0, default=None)

class NotaCreditoInDB(BaseModel):
    id: int
    numero_nc: str
    valor: float
    esfera: str
    fonte: str
    ptres: str
    plano_interno: str
    nd: str
    data_chegada: date
    prazo_empenho: date
    descricao: Optional[str]
    secao_responsavel_id: int
    secao_responsavel: SeçãoInDB
    saldo_disponivel: float
    status: str

    class Config:
        from_attributes = True

class EmpenhoCreate(BaseModel):
    numero_ne: str
    valor: float = Field(ge=0)
    data_empenho: date
    observacao: Optional[str] = None
    nota_credito_id: int
    secao_requisitante_id: int

class EmpenhoInDB(BaseModel):
    id: int
    numero_ne: str
    valor: float
    data_empenho: date
    observacao: Optional[str]
    nota_credito_id: int
    secao_requisitante_id: int

    class Config:
        from_attributes = True

class AnulacaoEmpenhoCreate(BaseModel):
    empenho_id: int
    valor: float = Field(ge=0)
    data: date
    observacao: Optional[str] = None

class AnulacaoEmpenhoInDB(BaseModel):
    id: int
    empenho_id: int
    valor: float
    data: date
    observacao: Optional[str]

    class Config:
        from_attributes = True

class RecolhimentoSaldoCreate(BaseModel):
    nota_credito_id: int
    valor: float = Field(ge=0)
    data: date
    observacao: Optional[str] = None

class RecolhimentoSaldoInDB(BaseModel):
    id: int
    nota_credito_id: int
    valor: float
    data: date
    observacao: Optional[str]

    class Config:
        from_attributes = True

class AuditLogInDB(BaseModel):
    id: int
    timestamp: datetime
    username: str
    action: str
    details: Optional[str]

    class Config:
        from_attributes = True

class GraficoData(BaseModel):
    labels: List[str]
    data: List[float]

@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        log_audit_action(db, "UNKNOWN", "LOGIN_FAILED", f"Failed login attempt for username: {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "scopes": [str(user.role)]}, expires_delta=access_token_expires
    )
    log_audit_action(db, user.username, "LOGIN_SUCCESS")
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me", response_model=UserInDB)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

@app.post("/users/", response_model=UserInDB, summary="Cria um novo usuário (Apenas Admins)")
async def create_user(user: UserCreate, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = get_password_hash(user.password)
    db_user = User(username=user.username, email=user.email, hashed_password=hashed_password, role=user.role)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    log_audit_action(db, admin_user.username, "USER_CREATED", f"Created user: {user.username} with role {user.role}")
    return db_user

@app.get("/users/", response_model=List[UserInDB], summary="Lista todos os usuários (Apenas Admins)")
async def read_users(db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    users = db.query(User).all()
    return users

@app.delete("/users/{user_id}", summary="Exclui um usuário (Apenas Admins)")
async def delete_user(user_id: int, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    username = user.username
    db.delete(user)
    db.commit()
    log_audit_action(db, admin_user.username, "USER_DELETED", f"Deleted user: {username}")
    return {"detail": "User deleted"}

@app.post("/secoes/", response_model=SeçãoInDB, summary="Cria uma nova seção (Apenas Admins)")
async def create_secao(secao: SeçãoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_secao = Seção(nome=secao.nome)
    try:
        db.add(db_secao)
        db.commit()
        db.refresh(db_secao)
        log_audit_action(db, current_user.username, "SECAO_CREATED", f"Created section: {secao.nome}")
        return db_secao
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Section name already exists")

@app.get("/secoes/", response_model=List[SeçãoInDB])
async def read_secoes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    secoes = db.query(Seção).all()
    return secoes

@app.put("/secoes/{secao_id}", response_model=SeçãoInDB, summary="Atualiza uma seção (Apenas Admins)")
async def update_secao(secao_id: int, secao: SeçãoCreate, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    db_secao = db.query(Seção).filter(Seção.id == secao_id).first()
    if not db_secao:
        raise HTTPException(status_code=404, detail="Section not found")
    db_secao.nome = secao.nome
    try:
        db.commit()
        db.refresh(db_secao)
        log_audit_action(db, admin_user.username, "SECAO_UPDATED", f"Updated section ID {secao_id} to: {secao.nome}")
        return db_secao
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Section name already exists")

@app.delete("/secoes/{secao_id}", summary="Exclui uma seção (Apenas Admins)")
async def delete_secao(secao_id: int, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    secao = db.query(Seção).filter(Seção.id == secao_id).first()
    if not secao:
        raise HTTPException(status_code=404, detail="Section not found")
    nome = secao.nome
    db.delete(secao)
    db.commit()
    log_audit_action(db, admin_user.username, "SECAO_DELETED", f"Deleted section: {nome}")
    return {"detail": "Section deleted"}

@app.post("/notas-credito/", response_model=NotaCreditoInDB, summary="Cria uma nova nota de crédito")
async def create_nota_credito(nc: NotaCreditoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if nc.saldo_disponivel is None:
        nc.saldo_disponivel = nc.valor
    if nc.prazo_empenho < nc.data_chegada:
        raise HTTPException(status_code=400, detail="Prazo para empenho não pode ser anterior à data de chegada")
    db_nc = NotaCredito(**nc.dict())
    try:
        db.add(db_nc)
        db.commit()
        db.refresh(db_nc)
        log_audit_action(db, current_user.username, "NC_CREATED", f"Created NC: {nc.numero_nc}")
        return db_nc
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Nota de crédito number already exists")

@app.get("/notas-credito/", response_model=List[NotaCreditoInDB], summary="Lista notas de crédito com filtros opcionais")
async def read_notas_credito(
    plano_interno: Optional[str] = Query(None),
    nd: Optional[str] = Query(None),
    secao_responsavel_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(NotaCredito).join(Seção, NotaCredito.secao_responsavel_id == Seção.id)
    if plano_interno:
        query = query.filter(NotaCredito.plano_interno.ilike(f"%{plano_interno}%"))
    if nd:
        query = query.filter(NotaCredito.nd.ilike(f"%{nd}%"))
    if secao_responsavel_id:
        query = query.filter(NotaCredito.secao_responsavel_id == secao_responsavel_id)
    if status:
        query = query.filter(NotaCredito.status == status)
    query = query.offset((page - 1) * page_size).limit(page_size)
    notas = query.all()
    return notas

@app.get("/notas-credito/{nc_id}", response_model=NotaCreditoInDB, summary="Obtém uma nota de crédito por ID")
async def read_nota_credito(nc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    nc = db.query(NotaCredito).filter(NotaCredito.id == nc_id).first()
    if not nc:
        raise HTTPException(status_code=404, detail="Nota de crédito not found")
    return nc

@app.put("/notas-credito/{nc_id}", response_model=NotaCreditoInDB, summary="Atualiza uma nota de crédito")
async def update_nota_credito(nc_id: int, nc: NotaCreditoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_nc = db.query(NotaCredito).filter(NotaCredito.id == nc_id).first()
    if not db_nc:
        raise HTTPException(status_code=404, detail="Nota de crédito not found")
    if nc.prazo_empenho < nc.data_chegada:
        raise HTTPException(status_code=400, detail="Prazo para empenho não pode ser anterior à data de chegada")
    for key, value in nc.dict().items():
        setattr(db_nc, key, value)
    if nc.saldo_disponivel is None:
        db_nc.saldo_disponivel = db_nc.valor
    try:
        db.commit()
        db.refresh(db_nc)
        log_audit_action(db, current_user.username, "NC_UPDATED", f"Updated NC ID {nc_id}")
        return db_nc
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Nota de crédito number already exists")

@app.delete("/notas-credito/{nc_id}", summary="Exclui uma nota de crédito (Apenas Admins)")
async def delete_nota_credito(nc_id: int, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    nc = db.query(NotaCredito).filter(NotaCredito.id == nc_id).first()
    if not nc:
        raise HTTPException(status_code=404, detail="Nota de crédito not found")
    numero_nc = nc.numero_nc
    db.delete(nc)
    db.commit()
    log_audit_action(db, admin_user.username, "NC_DELETED", f"Deleted NC: {numero_nc}")
    return {"detail": "Nota de crédito deleted"}

@app.post("/empenhos/", response_model=EmpenhoInDB, summary="Cria um novo empenho")
async def create_empenho(empenho: EmpenhoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    nc = db.query(NotaCredito).filter(NotaCredito.id == empenho.nota_credito_id).first()
    if not nc:
        raise HTTPException(status_code=404, detail="Nota de crédito not found")
    if nc.saldo_disponivel < empenho.valor:
        raise HTTPException(status_code=400, detail="Saldo insuficiente na NC")
    db_empenho = Empenho(**empenho.dict())
    db.add(db_empenho)
    nc.saldo_disponivel -= empenho.valor
    if nc.saldo_disponivel <= 0:
        nc.status = "Totalmente Empenhada"
    try:
        db.commit()
        db.refresh(db_empenho)
        log_audit_action(db, current_user.username, "EMPENHO_CREATED", f"Created empenho: {empenho.numero_ne} for NC {empenho.nota_credito_id}")
        return db_empenho
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Empenho number already exists")

@app.get("/empenhos/", response_model=List[EmpenhoInDB], summary="Lista empenhos (filtro por nota_credito_id opcional)")
async def read_empenhos(
    nota_credito_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Empenho)
    if nota_credito_id:
        query = query.filter(Empenho.nota_credito_id == nota_credito_id)
    query = query.offset((page - 1) * page_size).limit(page_size)
    empenhos = query.all()
    return empenhos

@app.get("/empenhos/{empenho_id}", response_model=EmpenhoInDB, summary="Obtém um empenho por ID")
async def read_empenho(empenho_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    empenho = db.query(Empenho).filter(Empenho.id == empenho_id).first()
    if not empenho:
        raise HTTPException(status_code=404, detail="Empenho not found")
    return empenho

@app.put("/empenhos/{empenho_id}", response_model=EmpenhoInDB, summary="Atualiza um empenho (Apenas Admins)")
async def update_empenho(empenho_id: int, empenho: EmpenhoCreate, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    db_empenho = db.query(Empenho).filter(Empenho.id == empenho_id).first()
    if not db_empenho:
        raise HTTPException(status_code=404, detail="Empenho not found")
    old_valor = db_empenho.valor
    nc = db.query(NotaCredito).filter(NotaCredito.id == empenho.nota_credito_id).first()
    if not nc:
        raise HTTPException(status_code=404, detail="Nota de crédito not found")
    if (nc.saldo_disponivel + old_valor) < empenho.valor:
        raise HTTPException(status_code=400, detail="Saldo insuficiente na NC para o novo valor")
    nc.saldo_disponivel = nc.saldo_disponivel + old_valor - empenho.valor
    for key, value in empenho.dict(exclude_unset=True).items():
        setattr(db_empenho, key, value)
    if nc.saldo_disponivel <= 0:
        nc.status = "Totalmente Empenhada"
    elif nc.status == "Totalmente Empenhada" and nc.saldo_disponivel > 0:
        nc.status = "Ativa"
    try:
        db.commit()
        db.refresh(db_empenho)
        log_audit_action(db, admin_user.username, "EMPENHO_UPDATED", f"Updated empenho ID {empenho_id}")
        return db_empenho
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Empenho number already exists")

@app.delete("/empenhos/{empenho_id}", summary="Exclui um empenho (Apenas Admins)")
async def delete_empenho(empenho_id: int, db: Session = Depends(get_db), admin_user: User = Depends(get_current_admin_user)):
    empenho = db.query(Empenho).filter(Empenho.id == empenho_id).first()
    if not empenho:
        raise HTTPException(status_code=404, detail="Empenho not found")
    numero_ne = empenho.numero_ne
    nc = db.query(NotaCredito).filter(NotaCredito.id == empenho.nota_credito_id).first()
    if nc:
        nc.saldo_disponivel += empenho.valor
        if nc.status == "Totalmente Empenhada":
            nc.status = "Ativa"
    db.delete(empenho)
    db.commit()
    log_audit_action(db, admin_user.username, "EMPENHO_DELETED", f"Deleted empenho: {numero_ne}")
    return {"detail": "Empenho deleted"}

@app.post("/anulacoes-empenho/", response_model=AnulacaoEmpenhoInDB, summary="Cria uma anulação de empenho")
async def create_anulacao(anulacao: AnulacaoEmpenhoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    empenho = db.query(Empenho).filter(Empenho.id == anulacao.empenho_id).first()
    if not empenho or empenho.valor < anulacao.valor:
        raise HTTPException(status_code=400, detail="Empenho não encontrado ou valor de anulação inválido")
    db_anulacao = AnulacaoEmpenho(**anulacao.dict())
    db.add(db_anulacao)
    empenho.valor -= anulacao.valor
    nc = db.query(NotaCredito).filter(NotaCredito.id == empenho.nota_credito_id).first()
    if nc:
        nc.saldo_disponivel += anulacao.valor
        if nc.status == "Totalmente Empenhada" and nc.saldo_disponivel > 0:
            nc.status = "Ativa"
    db.commit()
    db.refresh(db_anulacao)
    log_audit_action(db, current_user.username, "ANULACAO_CREATED", f"Created anulação for empenho {anulacao.empenho_id}")
    return db_anulacao

@app.post("/recolhimentos-saldo/", response_model=RecolhimentoSaldoInDB, summary="Cria um recolhimento de saldo")
async def create_recolhimento(recolhimento: RecolhimentoSaldoCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    nc = db.query(NotaCredito).filter(NotaCredito.id == recolhimento.nota_credito_id).first()
    if not nc:
        raise HTTPException(status_code=404, detail="Nota de crédito not found")
    if nc.saldo_disponivel < recolhimento.valor:
        raise HTTPException(status_code=400, detail="Saldo insuficiente para recolhimento")
    db_recolhimento = RecolhimentoSaldo(**recolhimento.dict())
    db.add(db_recolhimento)
    nc.saldo_disponivel -= recolhimento.valor
    db.commit()
    db.refresh(db_recolhimento)
    log_audit_action(db, current_user.username, "RECOLHIMENTO_CREATED", f"Created recolhimento for NC {recolhimento.nota_credito_id}")
    return db_recolhimento

@app.get("/recolhimentos-saldo/", response_model=List[RecolhimentoSaldoInDB], summary="Lista recolhimentos (filtro por nota_credito_id)")
async def read_recolhimentos(
    nota_credito_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(RecolhimentoSaldo)
    if nota_credito_id:
        query = query.filter(RecolhimentoSaldo.nota_credito_id == nota_credito_id)
    query = query.offset((page - 1) * page_size).limit(page_size)
    recolhimentos = query.all()
    return recolhimentos

@app.get("/dashboard/kpis", summary="Retorna KPIs do dashboard")
async def get_dashboard_kpis(
    plano_interno: Optional[str] = Query(None),
    nd: Optional[str] = Query(None),
    secao_responsavel_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    saldo_total = db.query(func.sum(NotaCredito.saldo_disponivel)).scalar() or 0.0
    ncs_ativas = db.query(NotaCredito).filter(NotaCredito.status == "Ativa").count()
    
    soma_empenhos = db.query(func.sum(Empenho.valor)).scalar() or 0.0
    soma_anulacoes = db.query(func.sum(AnulacaoEmpenho.valor)).scalar() or 0.0
    valor_empenhado_liquido = (soma_empenhos or 0.0) - (soma_anulacoes or 0.0)

    return {
        "saldo_disponivel_total": saldo_total,
        "valor_empenhado_total": valor_empenhado_liquido,
        "ncs_ativas": ncs_ativas
    }

@app.get("/dashboard/avisos", response_model=List[NotaCreditoInDB], summary="Retorna NCs com prazo de empenho próximo")
def get_dashboard_avisos(
    plano_interno: Optional[str] = Query(None),
    nd: Optional[str] = Query(None),
    secao_responsavel_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    data_limite = date.today() + timedelta(days=5)
    query = db.query(NotaCredito).filter(
        NotaCredito.prazo_empenho <= data_limite,
        NotaCredito.status == "Ativa"
    )
    if plano_interno:
        query = query.filter(NotaCredito.plano_interno.ilike(f"%{plano_interno}%"))
    if nd:
        query = query.filter(NotaCredito.nd.ilike(f"%{nd}%"))
    if secao_responsavel_id:
        query = query.filter(NotaCredito.secao_responsavel_id == secao_responsavel_id)
    if status:
        query = query.filter(NotaCredito.status == status)
    avisos = query.order_by(NotaCredito.prazo_empenho).all()
    return avisos

@app.get("/relatorios/pdf", summary="Gera um relatório consolidado em PDF")
def get_relatorio_pdf(
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user),
    plano_interno: Optional[str] = Query(None),
    nd: Optional[str] = Query(None),
    secao_responsavel_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    data_inicio: Optional[date] = Query(None),
    data_fim: Optional[date] = Query(None)
):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), topMargin=0.5*inch, bottomMargin=0.5*inch)
    styles = getSampleStyleSheet()
    styles['h2'].alignment = 1
    styles['h1'].alignment = 1
    styles['Normal'].fontSize = 8
    
    elements = []

    header_text = "MINISTÉRIO DA DEFESA<br/>EXÉRCITO BRASILEIRO<br/>2º CENTRO DE GEOINFORMAÇÃO"
    elements.append(Paragraph(header_text, styles['h2']))
    elements.append(Spacer(1, 0.2*inch))
    
    titulo = "RELATÓRIO GERAL DE NOTAS DE CRÉDITO"
    if secao_responsavel_id:
        secao = db.query(Seção).filter(Seção.id == secao_responsavel_id).first()
        if secao: titulo = f"RELATÓRIO DE NCs DA SEÇÃO: {secao.nome.upper()}"
    elif plano_interno:
        titulo = f"RELATÓRIO DE NCs DO PLANO INTERNO: {plano_interno.upper()}"
    
    elements.append(Paragraph(titulo, styles['h1']))
    elements.append(Paragraph(f"Gerado por: {current_user.username} em {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}", styles['Normal']))
    elements.append(Spacer(1, 0.25*inch))

    query = db.query(NotaCredito).order_by(NotaCredito.plano_interno)
    
    if plano_interno: query = query.filter(NotaCredito.plano_interno.ilike(f"%{plano_interno}%"))
    if nd: query = query.filter(NotaCredito.nd.ilike(f"%{nd}%"))
    if secao_responsavel_id: query = query.filter(NotaCredito.secao_responsavel_id == secao_responsavel_id)
    if status: query = query.filter(NotaCredito.status.ilike(f"%{status}%"))
    if data_inicio: query = query.filter(NotaCredito.data_chegada >= data_inicio)
    if data_fim: query = query.filter(NotaCredito.data_chegada <= data_fim)
    
    ncs = query.all()
    
    table_data = [["PI", "ND", "Nº da NC", "Seção", "Valor Original", "Saldo Disponível", "Status", "Prazo"]]
    for nc in ncs:
        table_data.append([
            nc.plano_interno, nc.nd, nc.numero_nc, nc.secao_responsavel.nome,
            f"R$ {nc.valor:,.2f}", f"R$ {nc.saldo_disponivel:,.2f}", nc.status,
            nc.prazo_empenho.strftime("%d/%m/%Y")
        ])

    table = Table(table_data, colWidths=[1.5*inch, 1*inch, 2*inch, 1.5*inch, 1.5*inch, 1.5*inch, 1*inch, 1*inch])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#003366")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor("#f0f0f0")),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    
    elements.append(table)
    doc.build(elements)
    buffer.seek(0)
    
    headers = {'Content-Disposition': 'inline; filename="relatorio.pdf"'}
    log_audit_action(db, current_user.username, "RELATORIO_GENERATED", f"Generated PDF report with filters: {plano_interno or 'all'}")
    return Response(content=buffer.getvalue(), media_type='application/pdf', headers=headers)

@app.get("/audit-logs", response_model=List[AuditLogInDB], summary="Retorna o log de auditoria (Apenas Admins)")
def read_audit_logs(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_current_admin_user)
):
    logs = db.query(AuditLog).order_by(desc(AuditLog.timestamp)).offset(skip).limit(limit).all()
    return logs

# Seed de usuário inicial
def create_first_admin():
    with SessionLocal() as db:
        if not db.query(User).filter(User.username == "admin").first():
            hashed_password = get_password_hash("admin123")
            admin = User(username="admin", email="admin@salc.com", hashed_password=hashed_password, role=UserRole.ADMINISTRADOR)
            db.add(admin)
            db.commit()
            print("Admin criado: username=admin, password=admin123")
            # Criar seção padrão
            if not db.query(Seção).first():
                secao_padrao = Seção(nome="Seção Padrão")
                db.add(secao_padrao)
                db.commit()
                print("Seção padrão criada")

if __name__ == "__main__":
    create_first_admin()
